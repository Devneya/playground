import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PROMPT_IDLE_MS, usePromptDraft } from "../../src/features/canvas/usePromptDraft";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("updates the field immediately and commits a typing burst once", () => {
  const commit = vi.fn();
  const { result } = renderHook(() => usePromptDraft("", commit));
  act(() => result.current.change("a"));
  act(() => vi.advanceTimersByTime(100));
  act(() => result.current.change("abc"));
  expect(result.current.text).toBe("abc");
  expect(commit).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(PROMPT_IDLE_MS));
  expect(commit.mock.calls).toEqual([["abc"]]);
});

it("does not commit between human-paced keystrokes before 800ms of idle time", () => {
  const commit = vi.fn();
  const { result } = renderHook(() => usePromptDraft("", commit));

  act(() => result.current.change("H"));
  act(() => vi.advanceTimersByTime(250));
  act(() => result.current.change("He"));
  act(() => vi.advanceTimersByTime(250));
  act(() => result.current.change("Hel"));
  act(() => vi.advanceTimersByTime(250));
  act(() => result.current.change("Hello"));

  expect(result.current.text).toBe("Hello");
  expect(commit).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(PROMPT_IDLE_MS - 1));
  expect(commit).not.toHaveBeenCalled();

  act(() => vi.advanceTimersByTime(1));
  expect(commit.mock.calls).toEqual([["Hello"]]);
});

it("flushes the latest character for an immediate send without waiting for the parent", () => {
  const commit = vi.fn();
  const { result } = renderHook(() => usePromptDraft("old", commit));
  act(() => result.current.change("latest Z"));
  act(() => expect(result.current.flush()).toBe("latest Z"));
  act(() => vi.advanceTimersByTime(PROMPT_IDLE_MS));
  expect(commit.mock.calls).toEqual([["latest Z"]]);
});

it("keeps newer typing when an earlier commit arrives, then respects an external undo", () => {
  const commit = vi.fn();
  const { result, rerender } = renderHook(({ value }) => usePromptDraft(value, commit), { initialProps: { value: "original" } });
  act(() => result.current.change("first"));
  act(() => result.current.flush());
  act(() => result.current.change("second"));
  rerender({ value: "first" });
  expect(result.current.text).toBe("second");
  rerender({ value: "original" });
  expect(result.current.text).toBe("original");
  act(() => vi.advanceTimersByTime(PROMPT_IDLE_MS));
  expect(commit.mock.calls).toEqual([["first"]]);
});

it("flushes pending edits when leaving the page or unmounting", () => {
  const commit = vi.fn();
  const { result, unmount } = renderHook(() => usePromptDraft("", commit));
  act(() => result.current.change("before pagehide"));
  act(() => vi.advanceTimersByTime(250));
  act(() => result.current.change("latest before pagehide"));
  act(() => window.dispatchEvent(new Event("pagehide")));
  act(() => result.current.change("before unmount"));
  unmount();
  expect(commit.mock.calls).toEqual([["latest before pagehide"], ["before unmount"]]);
  act(() => vi.advanceTimersByTime(PROMPT_IDLE_MS));
  expect(commit).toHaveBeenCalledTimes(2);
});
