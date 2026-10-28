import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, CoachApi, SessionEvent } from "../../shared/types";

const invoke = <T>(channel: string, input?: unknown) => ipcRenderer.invoke(channel, input) as Promise<T>;

const api: CoachApi = {
  bootstrap: () => invoke("app:bootstrap"),
  selectGuide: () => invoke("guide:select"),
  selectWorkspace: () => invoke("workspace:select"),
  startSession: (input) => invoke("session:start", input),
  checkCurrent: (input) => invoke("session:check", input),
  relocate: (input) => invoke("session:relocate", input),
  navigate: (input) => invoke("session:navigate", input),
  diagnoseError: (input) => invoke("error:diagnose", input),
  saveFeedback: (input) => invoke("feedback:save", input),
  exportFeedback: () => invoke("feedback:export"),
  setSettings: (input) => invoke("settings:set", input),
  resizeWindow: (input) => invoke("window:resize", input),
  hideWindow: () => invoke("window:hide"),
  quitApp: () => invoke("app:quit"),
  onSessionEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SessionEvent): void => listener(payload);
    ipcRenderer.on("session:event", handler);
    return () => ipcRenderer.removeListener("session:event", handler);
  },
  onSettingsChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AppSettings): void => listener(payload);
    ipcRenderer.on("settings:changed", handler);
    return () => ipcRenderer.removeListener("settings:changed", handler);
  },
};

contextBridge.exposeInMainWorld("coach", api);
