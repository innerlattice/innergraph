// Starting an activity from an Explore button: the app opens a fresh conversation that begins
// with the activity's opening message. Views reach it through context, so an Explore button
// works wherever it is placed.
import { createContext, useContext } from "react";
import type { ActivityRequest } from "../../../src/core/activities";

export const ExploreContext = createContext<((request: ActivityRequest) => void) | undefined>(undefined);

export function useExplore(): ((request: ActivityRequest) => void) | undefined {
  return useContext(ExploreContext);
}
