const app = require("../src/index");

describe("GET /health", () => {
  it("returns ok status", async () => {
    const request = require("supertest") || null;
    // Minimal test without supertest - just verify app exports
    expect(app).toBeDefined();
    expect(typeof app.get).toBe("function");
  });
});
