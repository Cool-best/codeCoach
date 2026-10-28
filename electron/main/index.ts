import path from "node:path";
import { realpath, stat, writeFile } from "node:fs/promises";
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { z } from "zod";
import type { ApiResult, AppSettings, Bootstrap } from "../../shared/types";
import { CoachService } from "./session";
import { LocalStore } from "./store";
import { diagnoseWithPlugins, seedDiagnosticPlugins } from "./diagnostic-plugins";
import { FeedbackStore } from "./feedback";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let store: LocalStore;
let feedbackStore: FeedbackStore;
let service: CoachService;
let isQuitting = false;
let isCollapsed = false;
let expandedBounds: Electron.Rectangle | undefined;

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = (error: unknown): ApiResult<never> => ({
  ok: false,
  error: {
    code: (error as { code?: string })?.code ?? "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
  },
});

function register(
  channel: string,
  handler: (input: unknown) => Promise<unknown>,
): void {
  ipcMain.handle(channel, async (_event, input) => {
    try {
      return ok(await handler(input));
    } catch (error) {
      console.error(channel, error);
      return fail(error);
    }
  });
}

async function createWindow(): Promise<void> {
  const settings = await store.getSettings();
  isCollapsed = settings.collapsed;
  mainWindow = new BrowserWindow({
    width: 440,
    height: settings.collapsed ? 112 : 700,
    minWidth: 360,
    minHeight: settings.collapsed ? 96 : 420,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: !settings.collapsed,
    maximizable: false,
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    opacity: settings.opacity,
    icon: path.join(app.getAppPath(), "resources/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.setAlwaysOnTop(settings.alwaysOnTop, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setIgnoreMouseEvents(settings.clickThrough, { forward: settings.clickThrough });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  if (app.isPackaged) await mainWindow.loadFile(path.join(__dirname, "../../../dist/renderer/index.html"));
  else await mainWindow.loadURL("http://127.0.0.1:5173");
}

function sendSettings(settings: AppSettings): void {
  mainWindow?.webContents.send("settings:changed", settings);
}

async function applySettings(settings: AppSettings): Promise<void> {
  if (!mainWindow) return;
  const wasCollapsed = isCollapsed;
  isCollapsed = settings.collapsed;
  if (settings.collapsed && !wasCollapsed) {
    expandedBounds = mainWindow.getBounds();
    mainWindow.setMinimumSize(360, 96);
    mainWindow.setSize(expandedBounds.width, 112);
    mainWindow.setResizable(false);
  } else if (!settings.collapsed && wasCollapsed) {
    const bounds = expandedBounds ?? { ...mainWindow.getBounds(), height: 700 };
    mainWindow.setMinimumSize(360, 420);
    mainWindow.setResizable(true);
    mainWindow.setBounds({ ...bounds, width: Math.max(360, bounds.width), height: Math.max(420, bounds.height) });
  }
  mainWindow.setOpacity(settings.opacity);
  mainWindow.setAlwaysOnTop(settings.alwaysOnTop, "screen-saver");
  mainWindow.setIgnoreMouseEvents(settings.clickThrough, { forward: settings.clickThrough });
  sendSettings(settings);
}

function toggleWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

async function toggleClickThrough(): Promise<void> {
  const settings = await store.saveSettings({ clickThrough: !(await store.getSettings()).clickThrough });
  await applySettings(settings);
  if (settings.clickThrough) mainWindow?.show();
}

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), "resources/icon.png"));
  tray = new Tray(icon);
  tray.setToolTip("CodeCoach · Ctrl+Alt+Space 显示/隐藏");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示 / 隐藏", click: toggleWindow },
      { label: "切换鼠标穿透 · Ctrl+Alt+P", click: () => void toggleClickThrough() },
      { type: "separator" },
      { label: "退出 CodeCoach", click: () => void quit() },
    ]),
  );
  tray.on("click", toggleWindow);
}

async function quit(): Promise<void> {
  isQuitting = true;
  await service.close();
  app.quit();
}

async function moduleFileExists(workspacePath: string, moduleFile?: string): Promise<boolean | undefined> {
  if (!moduleFile) return undefined;
  try {
    const root = await realpath(workspacePath);
    const candidate = path.resolve(root, ...moduleFile.split("/"));
    const relative = path.relative(root, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    const existing = await realpath(candidate);
    const existingRelative = path.relative(root, existing);
    if (existingRelative.startsWith("..") || path.isAbsolute(existingRelative)) return undefined;
    return (await stat(existing)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    return undefined;
  }
}

async function diagnoseSessionError(sessionId: string, errorText: string, currentDirectory?: string) {
  const context = service.context(sessionId);
  return diagnoseWithPlugins(errorText, {
    workspacePath: context.workspace.path,
    currentDirectory,
    verification: context.step.verification,
    moduleFileExists: await moduleFileExists(context.workspace.path, context.step.verification?.moduleFile),
  }, {
    builtInDirectory: path.join(app.getAppPath(), "resources/diagnostics"),
    pluginDirectory: path.join(app.getPath("appData"), "CodeCoach/diagnostics/plugins"),
  });
}

function registerIpc(): void {
  register("app:bootstrap", async (): Promise<Bootstrap> => {
    const settings = await store.getSettings();
    const result: Bootstrap = { settings };
    if (!settings.lastGuideId || !settings.lastWorkspaceId) return result;
    try {
      result.guide = await store.getGuide(settings.lastGuideId);
      result.workspace = await store.getWorkspace(settings.lastWorkspaceId);
      result.session = await service.start(result.guide, result.workspace);
    } catch (error) {
      result.notice = error instanceof Error ? error.message : String(error);
    }
    return result;
  });
  register("guide:select", async () => {
    if (!mainWindow) return null;
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: "选择 CodeCoach Markdown 教程",
      properties: ["openFile"],
      filters: [{ name: "Markdown 教程", extensions: ["md", "markdown"] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return store.importGuide(selected.filePaths[0]);
  });
  register("workspace:select", async () => {
    if (!mainWindow) return null;
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: "选择练习项目目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return store.registerWorkspace(selected.filePaths[0]);
  });
  register("session:start", async (raw) => {
    const input = z.object({ guideId: z.string(), workspaceId: z.string() }).parse(raw);
    const guide = await store.getGuide(input.guideId);
    const workspace = await store.getWorkspace(input.workspaceId);
    const session = await service.start(guide, workspace);
    await store.saveSettings({ lastGuideId: input.guideId, lastWorkspaceId: input.workspaceId });
    return session;
  });
  register("session:check", async (raw) => {
    const input = z.object({ sessionId: z.string() }).parse(raw);
    return service.checkCurrent(input.sessionId);
  });
  register("session:relocate", async (raw) => {
    const input = z.object({ sessionId: z.string() }).parse(raw);
    return service.relocate(input.sessionId);
  });
  register("session:navigate", async (raw) => {
    const input = z
      .object({
        sessionId: z.string(),
        action: z.enum(["previous", "next", "skip", "mark_completed", "undo"]),
        reason: z.string().max(1000).optional(),
      })
      .parse(raw);
    return service.navigate(input.sessionId, input.action, input.reason);
  });
  register("error:diagnose", async (raw) => {
    const input = z.object({
      sessionId: z.string(),
      errorText: z.string().min(1).max(100_000),
      currentDirectory: z.string().max(1000).optional(),
      usedOfficialSample: z.boolean(),
    }).strict().parse(raw);
    return diagnoseSessionError(input.sessionId, input.errorText, input.currentDirectory);
  });
  register("feedback:save", async (raw) => {
    const input = z.object({
      sessionId: z.string(),
      errorText: z.string().min(1).max(100_000),
      currentDirectory: z.string().max(1000).optional(),
      usedOfficialSample: z.boolean(),
      note: z.string().max(2000).optional(),
    }).strict().parse(raw);
    const context = service.context(input.sessionId);
    const diagnosis = await diagnoseSessionError(input.sessionId, input.errorText, input.currentDirectory);
    return feedbackStore.save({
      tutorialId: context.guide.tutorial.tutorialId,
      tutorialVersion: context.guide.tutorial.version,
      stepId: context.step.id,
      command: context.step.verification?.command.join(" "),
      currentDirectory: input.currentDirectory,
      usedOfficialSample: input.usedOfficialSample,
      errorText: input.errorText,
      note: input.note,
      diagnosis,
    });
  });
  register("feedback:export", async () => {
    if (!mainWindow) return null;
    const selected = await dialog.showSaveDialog(mainWindow, {
      title: "导出脱敏错误反馈",
      defaultPath: `codecoach-feedback-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (selected.canceled || !selected.filePath) return null;
    const reports = await feedbackStore.list();
    await writeFile(selected.filePath, `${JSON.stringify(reports, null, 2)}\n`, "utf8");
    return { path: selected.filePath, count: reports.length };
  });
  register("settings:set", async (raw) => {
    const input = z
      .object({
        opacity: z.number().min(0.45).max(1).optional(),
        alwaysOnTop: z.boolean().optional(),
        clickThrough: z.boolean().optional(),
        collapsed: z.boolean().optional(),
        autoAdvance: z.boolean().optional(),
      })
      .strict()
      .parse(raw);
    const settings = await store.saveSettings(input);
    await applySettings(settings);
    return settings;
  });
  register("window:resize", async (raw) => {
    const input = z.object({ width: z.number().int().min(360).max(3000), height: z.number().int().min(420).max(3000) }).strict().parse(raw);
    if (!isCollapsed) mainWindow?.setSize(input.width, input.height, false);
  });
  register("window:hide", async () => mainWindow?.hide());
  register("app:quit", quit);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  void app.whenReady().then(async () => {
    store = new LocalStore(app.getPath("userData"));
    feedbackStore = new FeedbackStore(app.getPath("userData"));
    await Promise.all([store.init(), feedbackStore.init()]);
    await seedDiagnosticPlugins({
      builtInDirectory: path.join(app.getAppPath(), "resources/diagnostics"),
      pluginDirectory: path.join(app.getPath("appData"), "CodeCoach/diagnostics/plugins"),
    });
    service = new CoachService(store, (event) => mainWindow?.webContents.send("session:event", event));
    registerIpc();
    await createWindow();
    createTray();
    globalShortcut.register("Control+Alt+Space", toggleWindow);
    globalShortcut.register("Control+Alt+P", () => void toggleClickThrough());
    app.on("activate", () => mainWindow?.show());
  }).catch((error: unknown) => {
    console.error(error);
    dialog.showErrorBox("CodeCoach 启动失败", error instanceof Error ? error.message : String(error));
    app.quit();
  });
}

app.on("before-quit", () => {
  isQuitting = true;
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => undefined);
