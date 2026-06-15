export class XFoilError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class XFoilBinaryNotFoundError extends XFoilError {
  readonly platform: string;
  readonly searched: string[];

  constructor(platform: string, searched: string[]) {
    super(
      [
        `No XFOIL binary was found for ${platform}.`,
        "Set XFOIL_BINARY_PATH, pass new XFoil({ binaryPath }), or install a supported @xfoil/<platform> package.",
        `Searched: ${searched.join(", ") || "(none)"}.`,
      ].join(" "),
    );
    this.platform = platform;
    this.searched = searched;
  }
}

export class XFoilTimeoutError extends XFoilError {
  readonly timeoutMs: number;
  readonly stdout: string;

  constructor(timeoutMs: number, stdout: string) {
    super(`XFOIL exceeded the ${timeoutMs} ms timeout.`);
    this.timeoutMs = timeoutMs;
    this.stdout = stdout;
  }
}

export class XFoilProcessError extends XFoilError {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(exitCode: number | null, stdout: string, stderr: string) {
    super(`XFOIL exited with code ${exitCode ?? "null"}.`);
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export class XFoilParseError extends XFoilError {
  readonly file: string | undefined;
  readonly snippet: string | undefined;

  constructor(message: string, options: { file?: string; snippet?: string } = {}) {
    super(message);
    this.file = options.file;
    this.snippet = options.snippet;
  }
}

export class XFoilInputError extends XFoilError {}
