/**
 * The on-device stand-in for `services/api`, with fictional data only. It
 * answers every request locally and never touches the network.
 */
import type { Session } from "../shell/state";
import type { Api, Home, HomeState, Me, Relationship, UpcomingDate } from "./types";

/** Mainland mobile numbers: 11 digits starting with 1. Format only; nothing is sent. */
const PHONE = /^1\d{10}$/;
const CODE = /^\d{6}$/;

/** The code the mock accepts. It is shown on the sign-in screen in the mock build. */
export const MOCK_CODE = "000000";

const DATE: UpcomingDate = {
  id: "date-demo-1",
  startsAt: "2026-11-21T07:00:00Z",
  timeZone: "Asia/Shanghai",
  venueName: "示例咖啡馆（虚构）",
  venueAddress: "示例路 1 号（虚构地址）",
  packageName: "双人下午茶套餐",
  amountMinor: 8_800,
  currency: "CNY",
  cancelRule: "开始前 24 小时取消全额退款；之后按商家规则处理。",
};

const RELATIONSHIP: Relationship = {
  id: "rel-demo-1",
  sharedName: "小林（虚构）",
  metOn: "2026-11-08",
  chatOpen: true,
};

function homeFor(state: HomeState, me: Me): Home {
  return {
    state,
    upcoming: state === "booked" ? DATE : null,
    relationships: state === "in_relationship" ? [RELATIONSHIP] : [],
    me,
  };
}

export interface MockOptions {
  /** Which of the four starting points the account is in. */
  readonly state?: HomeState;
  readonly verification?: Me["verification"];
  /** Delay before each answer, to see loading states. */
  readonly latencyMs?: number;
  /** Make `home` fail, to see the error state. */
  readonly failHome?: boolean;
}

export function createMockApi(options: MockOptions = {}): Api {
  const state = options.state ?? "new";
  let me: Me = {
    verification: options.verification ?? "not_started",
    matchingPaused: state === "in_relationship",
  };
  const wait = <T>(value: T) =>
    new Promise<T>((resolve) => {
      setTimeout(() => {
        resolve(value);
      }, options.latencyMs ?? 0);
    });
  const session = (phone: string): Session => ({ userId: `mock-${phone.slice(-4)}` });

  return {
    requestCode: (phone) =>
      wait(PHONE.test(phone) ? { ok: true } : { ok: false, problem: "invalid_phone" }),
    signIn: (phone, code) => {
      if (!PHONE.test(phone)) return wait({ ok: false, problem: "invalid_phone" });
      if (!CODE.test(code) || code !== MOCK_CODE)
        return wait({ ok: false, problem: "invalid_code" });
      return wait({ ok: true, session: session(phone) });
    },
    home: () =>
      options.failHome === true
        ? wait(null).then(() => Promise.reject(new Error("mock: home unavailable")))
        : wait(homeFor(state, me)),
    setMatchingPaused: (_session, paused) => {
      me = { ...me, matchingPaused: paused };
      return wait(me);
    },
  };
}
