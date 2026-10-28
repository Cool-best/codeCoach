import type { CoachApi } from "../shared/types";

declare global {
  interface Window {
    coach: CoachApi;
  }
}

export {};
