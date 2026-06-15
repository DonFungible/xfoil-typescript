import { readFile } from "node:fs/promises";
import { NodeNativeBackend } from "../backend/node-native.js";
import { XFoilInputError, XFoilProcessError, XFoilTimeoutError } from "../errors.js";
import { Airfoil } from "../geometry/airfoil.js";
import { parseCp, parseDump, parsePolar } from "../parsers/index.js";
import { parseCoordinatesText, sanitizeAirfoilName } from "../shared/coordinates.js";
import type {
  AirfoilInput,
  AnalysisResult,
  AnalyzeInput,
  Backend,
  Polar,
  PolarInput,
  PolarPoint,
  RawOptions,
  RawResult,
  RepanelOption,
  Session,
  SessionPlan,
  XFoilOptions,
} from "../types.js";
import { type AirfoilPlan, buildAnalyzeScript, buildPolarScript } from "./commands.js";
import {
  normalizeOptions,
  requestedValues,
  roundForComparison,
  validateAnalyzeInput,
  validateNaca,
  validatePolarInput,
} from "./options.js";
import { createSession, type InternalSessionPlan } from "./session.js";

interface PreparedAirfoil {
  inputFiles?: Record<string, string>;
  plan: AirfoilPlan;
}

export class XFoil {
  readonly #backend: Backend;
  readonly #options: ReturnType<typeof normalizeOptions>;

  constructor(options: XFoilOptions = {}) {
    this.#options = normalizeOptions(options);
    this.#backend =
      options.backend ??
      new NodeNativeBackend({
        allowPathLookup: this.#options.allowPathLookup,
        binaryPath: this.#options.binaryPath,
        env: this.#options.env,
        logger: options.logger,
        workDir: this.#options.workDir,
      });
  }

  async analyze(input: AnalyzeInput): Promise<AnalysisResult> {
    validateAnalyzeInput(input);
    const prepared = await this.#prepareAirfoil(
      input.airfoil,
      input.repanel ?? this.#options.repanel,
    );
    const polarFile = "polar.txt";
    const cpFile = input.cp ? "cp.txt" : undefined;
    const dumpFile = input.boundaryLayer ? "bl.txt" : undefined;
    const script = buildAnalyzeScript({
      ...input,
      airfoil: prepared.plan,
      cpFile,
      dumpFile,
      iterations: input.iterations ?? this.#options.iterations,
      polarFile,
    });

    const outputFiles = [polarFile, cpFile, dumpFile].filter((file): file is string =>
      Boolean(file),
    );
    const result = await this.#runChecked({
      inputFiles: prepared.inputFiles,
      outputFiles,
      script,
      timeoutMs: this.#options.timeoutMs,
    });
    const polarText = result.files[polarFile];
    const polar = polarText ? parsePolar(polarText) : emptyPolar(input, []);
    const point = selectAnalysisPoint(polar.points, input);
    const analysis = pointToAnalysis(point, input);

    const cpText = cpFile ? result.files[cpFile] : undefined;
    const dumpText = dumpFile ? result.files[dumpFile] : undefined;
    if (cpText) analysis.cp = parseCp(cpText);
    if (dumpText) analysis.boundaryLayer = parseDump(dumpText);
    if (this.#options.keepFiles) analysis.raw = { dir: result.dir, script, stdout: result.stdout };
    return analysis;
  }

  async polar(input: PolarInput): Promise<Polar> {
    validatePolarInput(input);
    const requested = requestedValues(input);
    const prepared = await this.#prepareAirfoil(
      input.airfoil,
      input.repanel ?? this.#options.repanel,
    );
    const polarFile = "polar.txt";
    const script = buildPolarScript({
      ...input,
      airfoil: prepared.plan,
      iterations: input.iterations ?? this.#options.iterations,
      polarFile,
    });
    const result = await this.#runChecked({
      inputFiles: prepared.inputFiles,
      outputFiles: [polarFile],
      script,
      timeoutMs: this.#options.timeoutMs,
    });

    const polarText = result.files[polarFile];
    const parsed = polarText ? parsePolar(polarText) : emptyPolar(input, requested);
    const compareBy = input.cl ? "cl" : "alpha";
    const failed = requested.filter(
      (value) =>
        !parsed.points.some(
          (point) =>
            Math.abs(roundForComparison(point[compareBy]) - roundForComparison(value)) < 1e-7,
        ),
    );
    const polar: Polar = {
      ...parsed,
      failed,
      mach: input.mach ?? parsed.mach ?? 0,
      ncrit: input.ncrit ?? parsed.ncrit ?? 9,
      raw: this.#options.keepFiles
        ? { dir: result.dir, file: polarFile, script, stdout: result.stdout }
        : undefined,
      requested,
      reynolds: input.reynolds ?? parsed.reynolds ?? Number.NaN,
    };

    if (input.cpAt?.length) {
      const cp: Record<number, NonNullable<AnalysisResult["cp"]>> = {};
      for (const alpha of input.cpAt) {
        const analysis = await this.analyze({
          airfoil: input.airfoil,
          alpha,
          boundaryLayer: false,
          cp: true,
          flap: input.flap,
          iterations: input.iterations,
          mach: input.mach,
          ncrit: input.ncrit,
          repanel: input.repanel,
          reynolds: input.reynolds,
          xtr: input.xtr,
        });
        if (analysis.cp) cp[alpha] = analysis.cp;
      }
      polar.cp = cp;
    }

    return polar;
  }

  async session<T>(build: (s: Session) => SessionPlan<T>): Promise<T> {
    const plan = build(createSession()) as InternalSessionPlan<T>;
    const inputFiles = plan.airfoilInput
      ? (await this.#prepareAirfoil(plan.airfoilInput, true)).inputFiles
      : plan.inputFiles;
    const result = await this.raw(plan.script, {
      inputFiles,
      outputFiles: plan.outputFiles,
    });
    return plan.collect(result);
  }

  async raw(commands: string[], options: RawOptions = {}): Promise<RawResult> {
    const result = await this.#backend.run({
      inputFiles: options.inputFiles,
      keepFiles: options.keepFiles ?? this.#options.keepFiles,
      outputFiles: options.outputFiles ?? [],
      script: commands,
      timeoutMs: options.timeoutMs ?? this.#options.timeoutMs,
    });

    return {
      dir: result.dir,
      exitCode: result.exitCode,
      files: result.files,
      stderr: result.stderr,
      stdout: result.stdout,
      timedOut: result.timedOut,
    };
  }

  version(): Promise<string> {
    return this.#backend.version();
  }

  isAvailable(): Promise<boolean> {
    return this.#backend.isAvailable();
  }

  async #runChecked(
    req: Parameters<Backend["run"]>[0],
  ): Promise<Awaited<ReturnType<Backend["run"]>>> {
    const result = await this.#backend.run({
      ...req,
      keepFiles: this.#options.keepFiles,
    });
    if (result.timedOut) throw new XFoilTimeoutError(req.timeoutMs, result.stdout);
    if (result.exitCode !== 0)
      throw new XFoilProcessError(result.exitCode, result.stdout, result.stderr);
    return result;
  }

  async #prepareAirfoil(input: AirfoilInput, repanel: RepanelOption): Promise<PreparedAirfoil> {
    if (input instanceof Airfoil) {
      return fileAirfoil(input.name, input.toDat(), repanel);
    }

    if (typeof input === "object" && input !== null && "naca" in input) {
      return {
        plan: {
          kind: "naca",
          naca: validateNaca(input.naca),
          repanel,
        },
      };
    }

    if (typeof input === "object" && input !== null && "coordinates" in input) {
      const airfoil = Airfoil.fromCoordinates(input.coordinates, input.name);
      return fileAirfoil(airfoil.name, airfoil.toDat(), repanel);
    }

    if (typeof input === "object" && input !== null && "dat" in input) {
      const parsed = parseCoordinatesText(input.dat);
      const name = sanitizeAirfoilName(input.name ?? parsed.name);
      return fileAirfoil(name, Airfoil.fromCoordinates(parsed.points, name).toDat(), repanel);
    }

    if (typeof input === "object" && input !== null && "datPath" in input) {
      const text = await readFile(input.datPath, "utf8");
      const airfoil = Airfoil.fromDat(text);
      return fileAirfoil(airfoil.name, airfoil.toDat(), repanel);
    }

    throw new XFoilInputError("Unsupported airfoil input.");
  }
}

function fileAirfoil(name: string, dat: string, repanel: RepanelOption): PreparedAirfoil {
  return {
    inputFiles: { "airfoil.dat": dat },
    plan: {
      file: "airfoil.dat",
      kind: "file",
      name,
      repanel,
    },
  };
}

function pointToAnalysis(point: PolarPoint | undefined, input: AnalyzeInput): AnalysisResult {
  if (!point) {
    return {
      alpha: input.alpha ?? Number.NaN,
      botXtr: Number.NaN,
      cd: Number.NaN,
      cdp: Number.NaN,
      cl: input.cl ?? Number.NaN,
      cm: Number.NaN,
      converged: false,
      topXtr: Number.NaN,
    };
  }

  return {
    alpha: point.alpha,
    botXtr: point.botXtr,
    cd: point.cd,
    cdp: point.cdp,
    cl: point.cl,
    cm: point.cm,
    converged: true,
    topXtr: point.topXtr,
  };
}

function selectAnalysisPoint(points: PolarPoint[], input: AnalyzeInput): PolarPoint | undefined {
  if (input.alpha !== undefined) {
    const alpha = input.alpha;
    return points.find((point) => Math.abs(point.alpha - alpha) < 1e-7) ?? points[0];
  }
  if (input.cl !== undefined) {
    const cl = input.cl;
    return points.find((point) => Math.abs(point.cl - cl) < 1e-7) ?? points[0];
  }
  return points[0];
}

function emptyPolar(input: PolarInput | AnalyzeInput, requested: number[]): Polar {
  return {
    airfoilName: "Airfoil",
    failed: [...requested],
    mach: input.mach ?? 0,
    ncrit: input.ncrit ?? 9,
    points: [],
    requested,
    reynolds: input.reynolds ?? Number.NaN,
  };
}
