export type SubscriptionStatus =
  | "none"
  | "pending"
  | "active"
  | "cancelled"
  | "past_due"
  | string;

export type UsageResponse = {
  used: number;
  limit: number;
  subscription_status: SubscriptionStatus;
};

export type SubscribeResponse =
  | { status: "active" }
  | { status: "checkout"; checkout_url: string };

export async function fetchUsage(
  proxyUrl: string,
  accessToken: string
): Promise<UsageResponse> {
  const resp = await fetch(`${proxyUrl}/account/usage`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    throw new Error(`Usage request failed (${resp.status})`);
  }
  return resp.json();
}

export async function startSubscription(
  proxyUrl: string,
  accessToken: string
): Promise<SubscribeResponse> {
  const resp = await fetch(`${proxyUrl}/account/subscribe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Subscribe failed (${resp.status}): ${body}`);
  }
  return resp.json();
}

export async function cancelSubscription(
  proxyUrl: string,
  accessToken: string
): Promise<{ status: string; access_until?: string }> {
  const resp = await fetch(`${proxyUrl}/account/subscribe/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Cancel failed (${resp.status}): ${body}`);
  }
  return resp.json();
}
