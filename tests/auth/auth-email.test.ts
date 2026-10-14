import { describe, expect, it } from "vitest";
import { authEmailLinkFrom, type AuthEmailMessage } from "../e2e/auth-email";

const address = "devneya-release@example.test";
const origin = "https://playground.example.test";

const verificationUrl = (type: "signup" | "recovery", redirect = origin) =>
  `https://api.devneya.com/auth/verify?token_hash=synthetic-${type}&type=${type}&redirect_to=${encodeURIComponent(redirect)}`;

const message = (url: string, recipient = address): AuthEmailMessage => ({
  to: [{ address: recipient }],
  text: `Use this link to continue: ${url}`,
});

describe("auth email verification links", () => {
  it.each(["signup", "recovery"] as const)("accepts the expected %s link", (type) => {
    const link = verificationUrl(type);

    expect(authEmailLinkFrom(message(link), address, origin, type)).toBe(link);
  });

  it("skips earlier signup emails and finds a recovery link among unrelated URLs", () => {
    const recoveryLink = verificationUrl("recovery");
    const recoveryMessage: AuthEmailMessage = {
      to: [{ address }],
      text: [
        "Account confirmation: " + verificationUrl("signup"),
        "Read the FAQ at https://help.example.test/account",
        "Reset password: " + recoveryLink,
      ].join("\n"),
    };

    expect(authEmailLinkFrom(recoveryMessage, address, origin, "recovery")).toBe(recoveryLink);
  });

  it("rejects a message sent to a different recipient", () => {
    expect(authEmailLinkFrom(message(verificationUrl("signup"), "other@example.test"), address, origin, "signup")).toBeNull();
  });

  it.each([
    "https://api.devneya.com.evil.example/auth/verify?type=signup&redirect_to=https%3A%2F%2Fplayground.example.test",
    verificationUrl("signup", "https://attacker.example.test/reset"),
    "http://api.devneya.com/auth/verify?type=signup&redirect_to=https%3A%2F%2Fplayground.example.test",
  ])("rejects an invalid verification destination: %s", (link) => {
    expect(authEmailLinkFrom(message(link), address, origin, "signup")).toBeNull();
  });

  it("returns no link when a message has no auth verification URL", () => {
    const unrelated: AuthEmailMessage = {
      to: [{ address }],
      text: "Read the account guide at https://help.example.test/account",
      html: ["<a href=\"https://support.example.test/contact\">Support</a>"],
    };

    expect(authEmailLinkFrom(unrelated, address, origin, "signup")).toBeNull();
  });
});
