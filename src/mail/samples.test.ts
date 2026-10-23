import { describe, expect, test } from "bun:test";
import { senderDomain } from "./senders";
import { SAMPLE_MAILS } from "./samples";
import { suspiciousReason } from "./suspicious";

describe("SAMPLE_MAILS", () => {
  test.each(Object.entries(SAMPLE_MAILS))("%s uses only example domains", (_kind, mail) => {
    const fromDomain = senderDomain(mail.from);
    expect(fromDomain).not.toBeNull();
    expect(fromDomain).toMatch(/\.example$/);

    for (const link of mail.links) {
      expect(new URL(link).hostname).toMatch(/\.example$/);
    }
  });

  test("only the falso sample is suspicious", () => {
    expect(suspiciousReason(SAMPLE_MAILS.falso)).not.toBeNull();

    for (const [kind, mail] of Object.entries(SAMPLE_MAILS)) {
      if (kind === "falso") continue;
      expect(suspiciousReason(mail)).toBeNull();
    }
  });
});
