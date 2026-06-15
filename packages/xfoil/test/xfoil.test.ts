import { describe, expect, it } from "vitest";
import { XFoil } from "../src/core/xfoil.js";
import type { XFoilTimeoutError } from "../src/errors.js";
import type { Backend, RunRequest, RunResult } from "../src/types.js";

const polarText = `
 Calculated polar for: NACA 2412
 Mach =   0.000     Re =     1.000 e 6     Ncrit =   9.000
   alpha    CL        CD       CDp       CM     Top_Xtr  Bot_Xtr
  ------ -------- --------- --------- -------- -------- --------
  -2.000  -0.0500   0.00600   0.00200  -0.0500   0.8000   0.5000
   2.000   0.4500   0.00650   0.00210  -0.0520   0.7000   0.4500
`;

const cpText = `
# x Cp
1.0 0.2
0.5 -0.5
`;

class FakeBackend implements Backend {
  constructor(readonly result?: Partial<RunResult>) {}

  requests: RunRequest[] = [];

  async run(req: RunRequest): Promise<RunResult> {
    this.requests.push(req);
    const files: Record<string, string> = {};
    for (const file of req.outputFiles) {
      if (file.includes("cp")) files[file] = cpText;
      else if (file.includes("polar")) files[file] = polarText;
    }
    return {
      durationMs: 1,
      exitCode: 0,
      files,
      stderr: "",
      stdout: "XFOIL Version 6.99",
      timedOut: false,
      ...this.result,
    };
  }

  async version(): Promise<string> {
    return "6.99";
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

describe("XFoil orchestration", () => {
  it("assembles analyze results from backend files", async () => {
    const backend = new FakeBackend();
    const xf = new XFoil({ backend });
    const result = await xf.analyze({
      airfoil: { naca: "2412" },
      alpha: 2,
      cp: true,
      reynolds: 1_000_000,
    });

    expect(result.converged).toBe(true);
    expect(result.cl).toBe(0.45);
    expect(result.cp?.x).toEqual([1, 0.5]);
    expect(backend.requests[0]?.script).toContain("ALFA 2");
  });

  it("computes failed polar requests", async () => {
    const xf = new XFoil({ backend: new FakeBackend() });
    const polar = await xf.polar({
      airfoil: { naca: "2412" },
      alpha: { start: -2, end: 2, step: 2 },
    });

    expect(polar.requested).toEqual([-2, 0, 2]);
    expect(polar.failed).toEqual([0]);
    expect(polar.points).toHaveLength(2);
  });

  it("delegates availability probes to the backend", async () => {
    const xf = new XFoil({ backend: new FakeBackend() });
    await expect(xf.version()).resolves.toBe("6.99");
    await expect(xf.isAvailable()).resolves.toBe(true);
  });

  it("passes ramped alpha setup before the recorded point", async () => {
    const backend = new FakeBackend();
    const xf = new XFoil({ backend });

    await xf.analyze({
      airfoil: { naca: "0012" },
      alpha: 2,
      ramp: true,
    });

    expect(backend.requests[0]?.script).toEqual(
      expect.arrayContaining(["ALFA 1", "PACC", "ALFA 2"]),
    );
    expect(backend.requests[0]?.script.indexOf("ALFA 1")).toBeLessThan(
      backend.requests[0]?.script.indexOf("PACC") ?? -1,
    );
  });

  it("raises XFoilTimeoutError when the backend times out", async () => {
    const xf = new XFoil({
      backend: new FakeBackend({ stdout: "partial transcript", timedOut: true }),
      timeoutMs: 123,
    });

    await expect(
      xf.analyze({
        airfoil: { naca: "0012" },
        alpha: 2,
      }),
    ).rejects.toMatchObject({
      name: "XFoilTimeoutError",
      stdout: "partial transcript",
      timeoutMs: 123,
    } satisfies Partial<XFoilTimeoutError>);
  });
});
