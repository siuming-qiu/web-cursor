"use client";

export type WebContainerProjectFile = {
  path: string;
  content: string;
};

export const WEB_CONTAINER_RUN_EVENT = {
  BootStart: "BOOT_START",
  BootReady: "BOOT_READY",
  MountStart: "MOUNT_START",
  MountReady: "MOUNT_READY",
  InstallStart: "INSTALL_START",
  InstallLog: "INSTALL_LOG",
  InstallError: "INSTALL_ERROR",
  DevServerStart: "DEV_SERVER_START",
  DevServerLog: "DEV_SERVER_LOG",
  DevServerError: "DEV_SERVER_ERROR",
  ServerReady: "SERVER_READY",
} as const;

export type WebContainerRunEvent =
  | { type: typeof WEB_CONTAINER_RUN_EVENT.BootStart }
  | { type: typeof WEB_CONTAINER_RUN_EVENT.BootReady }
  | { type: typeof WEB_CONTAINER_RUN_EVENT.MountStart }
  | { type: typeof WEB_CONTAINER_RUN_EVENT.MountReady }
  | { type: typeof WEB_CONTAINER_RUN_EVENT.InstallStart }
  | { type: typeof WEB_CONTAINER_RUN_EVENT.InstallLog; text: string }
  | { type: typeof WEB_CONTAINER_RUN_EVENT.InstallError; exitCode: number; rawLog: string }
  | { type: typeof WEB_CONTAINER_RUN_EVENT.DevServerStart }
  | { type: typeof WEB_CONTAINER_RUN_EVENT.DevServerLog; text: string }
  | { type: typeof WEB_CONTAINER_RUN_EVENT.DevServerError; exitCode: number | null; rawLog: string }
  | { type: typeof WEB_CONTAINER_RUN_EVENT.ServerReady; port: number; url: string };

export class WebContainerUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebContainerUserError";
  }
}

export class WebContainerInstallError extends Error {
  exitCode: number;
  rawLog: string;

  constructor(exitCode: number, rawLog: string) {
    super(`npm install failed with exit code ${exitCode}`);
    this.name = "WebContainerInstallError";
    this.exitCode = exitCode;
    this.rawLog = rawLog;
  }
}

export class WebContainerDevServerError extends Error {
  exitCode: number | null;
  rawLog: string;

  constructor(message: string, exitCode: number | null, rawLog: string) {
    super(message);
    this.name = "WebContainerDevServerError";
    this.exitCode = exitCode;
    this.rawLog = rawLog;
  }
}
