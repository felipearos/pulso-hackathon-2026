import { describe, expect, test } from "bun:test";
import { createHttpWeb } from "./http";

const domains = ["tiendaplaza.example"];

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const respond = responses[url];
    if (!respond) throw new Error(`unexpected fetch ${url}`);
    return respond();
  };
  return { fetch, calls };
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

describe("createHttpWeb", () => {
  test("returns the body and content type of an allowed link", async () => {
    const { fetch, calls } = fakeFetch({
      "https://www.tiendaplaza.example/estado.pdf": () =>
        new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { headers: { "content-type": "application/pdf" } }),
    });
    const doc = await createHttpWeb({ fetch }).fetchDocument("https://www.tiendaplaza.example/estado.pdf", domains);
    expect(doc.contentType).toBe("application/pdf");
    expect([...doc.body]).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.redirect).toBe("manual");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("reports an empty content type when the header is absent", async () => {
    const { fetch } = fakeFetch({
      "https://tiendaplaza.example/": () => {
        const response = new Response(new Uint8Array([1]));
        response.headers.delete("content-type");
        return response;
      },
    });
    const doc = await createHttpWeb({ fetch }).fetchDocument("https://tiendaplaza.example/", domains);
    expect(doc.contentType).toBe("");
  });

  test("refuses a link outside the domains without fetching it", async () => {
    const { fetch, calls } = fakeFetch({});
    const web = createHttpWeb({ fetch });
    await expect(web.fetchDocument("https://tiendaplaza.example.evil.example/estado.pdf", domains)).rejects.toThrow(
      /allowed domains/,
    );
    expect(calls).toHaveLength(0);
  });

  test("follows a redirect inside the domains, resolving a relative location", async () => {
    const { fetch, calls } = fakeFetch({
      "https://tiendaplaza.example/e/abc": () => redirect("/docs/estado.html"),
      "https://tiendaplaza.example/docs/estado.html": () =>
        new Response("<p>Estado</p>", { headers: { "content-type": "text/html; charset=utf-8" } }),
    });
    const doc = await createHttpWeb({ fetch }).fetchDocument("https://tiendaplaza.example/e/abc", domains);
    expect(new TextDecoder().decode(doc.body)).toBe("<p>Estado</p>");
    expect(calls.map((c) => c.url)).toEqual(["https://tiendaplaza.example/e/abc", "https://tiendaplaza.example/docs/estado.html"]);
  });

  test("refuses a redirect out of the domains", async () => {
    const { fetch, calls } = fakeFetch({
      "https://tiendaplaza.example/e/abc": () => redirect("https://evil.example/estado.pdf"),
    });
    await expect(createHttpWeb({ fetch }).fetchDocument("https://tiendaplaza.example/e/abc", domains)).rejects.toThrow(
      /evil\.example/,
    );
    expect(calls).toHaveLength(1);
  });

  test("gives up after three redirects", async () => {
    const { fetch, calls } = fakeFetch({
      "https://tiendaplaza.example/1": () => redirect("/2"),
      "https://tiendaplaza.example/2": () => redirect("/3"),
      "https://tiendaplaza.example/3": () => redirect("/4"),
      "https://tiendaplaza.example/4": () => redirect("/5"),
      "https://tiendaplaza.example/5": () => new Response("late"),
    });
    await expect(createHttpWeb({ fetch }).fetchDocument("https://tiendaplaza.example/1", domains)).rejects.toThrow(
      /redirects/,
    );
    expect(calls).toHaveLength(4);
  });

  test("throws naming the status on a non-2xx answer", async () => {
    const { fetch } = fakeFetch({
      "https://tiendaplaza.example/missing": () => new Response("no", { status: 404 }),
    });
    await expect(createHttpWeb({ fetch }).fetchDocument("https://tiendaplaza.example/missing", domains)).rejects.toThrow(
      /404/,
    );
  });

  test("refuses a body declared over the limit", async () => {
    const { fetch } = fakeFetch({
      "https://tiendaplaza.example/big": () => new Response("tiny", { headers: { "content-length": "100" } }),
    });
    await expect(
      createHttpWeb({ fetch, maxBytes: 10 }).fetchDocument("https://tiendaplaza.example/big", domains),
    ).rejects.toThrow(/over the 10 limit/);
  });

  test("refuses a body over the limit without a content-length", async () => {
    const { fetch } = fakeFetch({
      "https://tiendaplaza.example/big": () => new Response(new Uint8Array(11)),
    });
    await expect(
      createHttpWeb({ fetch, maxBytes: 10 }).fetchDocument("https://tiendaplaza.example/big", domains),
    ).rejects.toThrow(/over the 10 limit/);
  });
});
