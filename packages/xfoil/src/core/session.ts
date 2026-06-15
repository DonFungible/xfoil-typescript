import { parseCp, parseDump, parsePolar } from "../parsers/index.js";
import type {
  AirfoilInput,
  BoundaryLayer,
  CpDistribution,
  OperSession,
  Polar,
  RawResult,
  Session,
  SessionPlan,
} from "../types.js";
import { prelude } from "./commands.js";
import { formatNumber } from "./format.js";
import { validateNaca } from "./options.js";

export interface InternalSessionPlan<T> extends SessionPlan<T> {
  airfoilInput?: AirfoilInput | undefined;
}

interface SessionState {
  airfoilInput?: AirfoilInput;
  blFiles: string[];
  cpFiles: string[];
  lines: string[];
  outputFiles: string[];
  paccOpen: boolean;
  polarFile?: string;
}

export function createSession(): Session {
  return new SessionBuilder({
    blFiles: [],
    cpFiles: [],
    lines: [...prelude()],
    outputFiles: [],
    paccOpen: false,
  });
}

class SessionBuilder implements Session {
  readonly #state: SessionState;

  constructor(state: SessionState) {
    this.#state = state;
  }

  naca(d: string): Session {
    this.#state.lines.push(`NACA ${validateNaca(d)}`);
    return this;
  }

  load(input: AirfoilInput): Session {
    if (typeof input === "object" && input !== null && "naca" in input) {
      return this.naca(input.naca);
    }

    this.#state.airfoilInput = input;
    this.#state.lines.push("LOAD airfoil.dat", "");
    return this;
  }

  pane(panels?: number): Session {
    if (panels === undefined) {
      this.#state.lines.push("PANE");
    } else {
      this.#state.lines.push("PPAR", "N", formatNumber(panels, "repanel.panels"), "", "");
    }
    return this;
  }

  raw(line: string): Session {
    this.#state.lines.push(line);
    return this;
  }

  oper(): OperSession {
    this.#state.lines.push("OPER");
    return new OperSessionBuilder(this.#state);
  }
}

class OperSessionBuilder implements OperSession {
  readonly #state: SessionState;

  constructor(state: SessionState) {
    this.#state = state;
  }

  visc(re: number): OperSession {
    this.#state.lines.push(`VISC ${formatNumber(re, "reynolds")}`);
    return this;
  }

  inviscid(): OperSession {
    this.#state.lines.push("VISC");
    return this;
  }

  mach(m: number): OperSession {
    this.#state.lines.push(`MACH ${formatNumber(m, "mach")}`);
    return this;
  }

  iter(n: number): OperSession {
    this.#state.lines.push(`ITER ${formatNumber(n, "iterations")}`);
    return this;
  }

  vpar(p: { ncrit?: number; xtr?: { top?: number; bottom?: number } }): OperSession {
    this.#state.lines.push("VPAR");
    if (p.ncrit !== undefined) this.#state.lines.push(`N ${formatNumber(p.ncrit, "ncrit")}`);
    if (p.xtr) {
      this.#state.lines.push(
        `XTR ${formatNumber(p.xtr.top ?? 1, "xtr.top")} ${formatNumber(p.xtr.bottom ?? 1, "xtr.bottom")}`,
      );
    }
    this.#state.lines.push("");
    return this;
  }

  alfa(deg: number): OperSession {
    this.#ensurePacc();
    this.#state.lines.push(`ALFA ${formatNumber(deg, "alpha")}`);
    return this;
  }

  cl(cl: number): OperSession {
    this.#ensurePacc();
    this.#state.lines.push(`CL ${formatNumber(cl, "cl")}`);
    return this;
  }

  aseq(start: number, end: number, step: number): OperSession {
    this.#ensurePacc();
    this.#state.lines.push(
      `ASEQ ${formatNumber(start)} ${formatNumber(end)} ${formatNumber(step)}`,
    );
    return this;
  }

  cseq(start: number, end: number, step: number): OperSession {
    this.#ensurePacc();
    this.#state.lines.push(
      `CSEQ ${formatNumber(start)} ${formatNumber(end)} ${formatNumber(step)}`,
    );
    return this;
  }

  pacc(): OperSession {
    this.#ensurePacc();
    return this;
  }

  cpwr(): OperSession {
    const file = `cp_${this.#state.cpFiles.length + 1}.txt`;
    this.#state.cpFiles.push(file);
    this.#state.outputFiles.push(file);
    this.#state.lines.push(`CPWR ${file}`);
    return this;
  }

  dump(): OperSession {
    const file = `bl_${this.#state.blFiles.length + 1}.txt`;
    this.#state.blFiles.push(file);
    this.#state.outputFiles.push(file);
    this.#state.lines.push(`DUMP ${file}`);
    return this;
  }

  collect(): InternalSessionPlan<{ polar?: Polar; cps: CpDistribution[]; bls: BoundaryLayer[] }> {
    if (this.#state.paccOpen) {
      this.#state.lines.push("PACC");
      this.#state.paccOpen = false;
    }
    this.#state.lines.push("", "QUIT");
    const state = this.#state;

    return {
      airfoilInput: state.airfoilInput,
      outputFiles: [...state.outputFiles],
      script: [...state.lines],
      collect(result: RawResult) {
        const polarText = state.polarFile ? result.files[state.polarFile] : undefined;
        const polar = polarText ? parsePolar(polarText) : undefined;
        const cps = state.cpFiles.flatMap((file) => {
          const text = result.files[file];
          return text ? [parseCp(text)] : [];
        });
        const bls = state.blFiles.flatMap((file) => {
          const text = result.files[file];
          return text ? [parseDump(text)] : [];
        });
        return polar ? { bls, cps, polar } : { bls, cps };
      },
    };
  }

  raw(line: string): OperSession {
    this.#state.lines.push(line);
    return this;
  }

  #ensurePacc(): void {
    if (this.#state.polarFile) return;
    this.#state.polarFile = "session_polar.txt";
    this.#state.outputFiles.push(this.#state.polarFile);
    this.#state.lines.push("PACC", this.#state.polarFile, "");
    this.#state.paccOpen = true;
  }
}
