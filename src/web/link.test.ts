import { describe, expect, test } from "bun:test";
import { allowedLink } from "./link";

const domains = ["tiendaplaza.example"];

describe("allowedLink", () => {
  const cases: Array<[url: string, allowed: boolean]> = [
    ["https://tiendaplaza.example/estado.pdf", true],
    ["https://www.tiendaplaza.example/estado.pdf", true],
    ["https://WWW.TiendaPlaza.Example/estado.pdf", true],
    ["https://tiendaplaza.example:443/estado.pdf", true],
    ["http://tiendaplaza.example/estado.pdf", false],
    ["https://tiendaplaza.example:8443/estado.pdf", false],
    ["https://user:pass@tiendaplaza.example/estado.pdf", false],
    ["https://user@tiendaplaza.example/estado.pdf", false],
    ["https://tiendaplaza.example.evil.example/estado.pdf", false],
    ["https://tiendaplaza-seguro.example/estado.pdf", false],
    ["https://eviltiendaplaza.example/estado.pdf", false],
    ["ftp://tiendaplaza.example/estado.pdf", false],
    ["javascript:alert(1)", false],
    ["not a url", false],
    ["", false],
  ];

  for (const [url, allowed] of cases) {
    test(`${allowed ? "allows" : "refuses"} ${JSON.stringify(url)}`, () => {
      const result = allowedLink(url, domains);
      if (allowed) expect(result).toBeInstanceOf(URL);
      else expect(result).toBeNull();
    });
  }

  test("refuses everything when no domain is allowed", () => {
    expect(allowedLink("https://tiendaplaza.example/", [])).toBeNull();
  });
});
