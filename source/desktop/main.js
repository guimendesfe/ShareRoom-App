const {
    app,
    BrowserWindow,
    ipcMain,
    desktopCapturer,
    session,
    Menu,
    safeStorage,
} = require("electron");

const {
    spawn,
    execFile,
} = require("node:child_process");

const {
    promisify,
} = require("node:util");

const {
    pathToFileURL,
} = require("node:url");

const path =
    require("node:path");

const fs =
    require("node:fs");

const os =
    require("node:os");


/*
 * =========================
 * CONFIGURAÇÃO
 * =========================
 */

const APP_USER_MODEL_ID =
    "com.shareroom.app";

const PRODUCTION_API_URL =
    "https://share-room-nine.vercel.app";

const DEVELOPMENT_API_URL =
    process.env.SHAREROOM_API_URL ||
    "http://localhost:3001";

const API_URL =
    app.isPackaged
        ? PRODUCTION_API_URL
        : DEVELOPMENT_API_URL;

const DEVELOPMENT_RENDERER_URL =
    "http://localhost:5173";


/*
 * =========================
 * ÍCONE DO APLICATIVO
 * =========================
 *
 * Desenvolvimento:
 * build/icon.ico
 *
 * Produção:
 * resources/icon.ico
 */

const WINDOW_ICON_PATH =
    app.isPackaged
        ? path.join(
            process.resourcesPath,
            "icon.ico"
        )
        : path.join(
            __dirname,
            "build",
            "icon.ico"
        );


const MIN_WINDOW_AUDIO_BUILD =
    20348;

const MIN_VIEWERS =
    1;

const MAX_VIEWERS =
    12;

const MAX_PARTICIPANT_NAME_LENGTH =
    80;

const REQUEST_TIMEOUT_MS =
    10_000;

const END_SESSION_TIMEOUT_MS =
    3_000;

const HOST_CREDENTIALS_MAX_BYTES =
    16 * 1024;

const CHANNEL_ID_PATTERN =
    /^[A-Za-z0-9_-]{12}$/;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SECRET_PATTERN =
    /^[A-Za-z0-9_-]{32,128}$/;

const SOURCE_ID_PATTERN =
    /^(screen|window):.+$/;

const execFileAsync =
    promisify(
        execFile
    );


/*
 * =========================
 * IDENTIDADE WINDOWS
 * =========================
 */

if (
    process.platform ===
    "win32"
) {
    app.setAppUserModelId(
        APP_USER_MODEL_ID
    );
}


/*
 * =========================
 * VALIDAR API URL
 * =========================
 */

function validateApiUrl() {
    let parsed;

    try {
        parsed =
            new URL(
                API_URL
            );
    } catch {
        throw new Error(
            "URL do backend ShareRoom inválida."
        );
    }


    if (
        app.isPackaged &&
        parsed.protocol !==
        "https:"
    ) {
        throw new Error(
            "O backend de produção do ShareRoom exige HTTPS."
        );
    }


    if (
        !app.isPackaged &&
        parsed.protocol !==
        "http:" &&
        parsed.protocol !==
        "https:"
    ) {
        throw new Error(
            "Protocolo inválido para o backend de desenvolvimento."
        );
    }
}


validateApiUrl();


/*
 * =========================
 * ESTADO GLOBAL
 * =========================
 */

let mainWindow =
    null;

let selectedSourceId =
    null;

let selectedAudioMode =
    "off";

let selectedProcessId =
    null;

let activeHostSessionId =
    null;

let nativeAudioProcess =
    null;

let nativeAudioKey =
    null;

let shutdownStarted =
    false;

let shutdownComplete =
    false;


/*
 * =========================
 * LOG SEGURO
 * =========================
 */

function logMainError(
    context,
    error
) {
    if (
        app.isPackaged
    ) {
        return;
    }


    const message =
        error instanceof Error
            ? error.message
            : String(
                error
            );


    console.error(
        `[ShareRoom] ${context}: ${message}`
    );
}


/*
 * =========================
 * VALIDAÇÕES
 * =========================
 */

function isValidChannelId(
    channelId
) {
    return (
        typeof channelId ===
        "string" &&
        CHANNEL_ID_PATTERN.test(
            channelId
        )
    );
}


function isValidSessionId(
    sessionId
) {
    return (
        typeof sessionId ===
        "string" &&
        UUID_PATTERN.test(
            sessionId
        )
    );
}


function isValidSecret(
    secret
) {
    return (
        typeof secret ===
        "string" &&
        SECRET_PATTERN.test(
            secret
        )
    );
}


function isValidSourceId(
    sourceId
) {
    return (
        typeof sourceId ===
        "string" &&
        sourceId.length <=
        512 &&
        SOURCE_ID_PATTERN.test(
            sourceId
        )
    );
}


function normalizeParticipantName(
    value
) {
    if (
        typeof value !==
        "string"
    ) {
        return "Host";
    }


    const normalized =
        value
            .replace(
                /[\u0000-\u001F\u007F]/g,
                " "
            )
            .replace(
                /\s+/g,
                " "
            )
            .trim()
            .slice(
                0,
                MAX_PARTICIPANT_NAME_LENGTH
            );


    return (
        normalized ||
        "Host"
    );
}


function normalizeMaxViewers(
    value
) {
    const parsed =
        Number(
            value
        );


    if (
        !Number.isInteger(
            parsed
        ) ||
        parsed <
        MIN_VIEWERS ||
        parsed >
        MAX_VIEWERS
    ) {
        throw new Error(
            `O limite de espectadores deve estar entre ${MIN_VIEWERS} e ${MAX_VIEWERS}.`
        );
    }


    return parsed;
}


function isValidLiveKitUrl(
    value
) {
    if (
        typeof value !==
        "string"
    ) {
        return false;
    }


    try {
        const parsed =
            new URL(
                value
            );


        if (
            parsed.protocol ===
            "wss:"
        ) {
            return true;
        }


        if (
            !app.isPackaged &&
            parsed.protocol ===
            "ws:"
        ) {
            return true;
        }


        return false;

    } catch {
        return false;
    }
}


/*
 * =========================
 * FETCH SEGURO
 * =========================
 */

async function fetchJson(
    url,
    options = {},
    timeoutMs =
        REQUEST_TIMEOUT_MS
) {
    const controller =
        new AbortController();


    const timeout =
        setTimeout(
            () => {
                controller.abort();
            },
            timeoutMs
        );


    try {
        const response =
            await fetch(
                url,
                {
                    ...options,

                    headers: {
                        Accept:
                            "application/json",

                        "Cache-Control":
                            "no-store",

                        ...(
                            options.headers ||
                            {}
                        ),
                    },

                    signal:
                        controller.signal,

                    redirect:
                        "error",
                }
            );


        const text =
            await response
                .text();


        let data =
            {};


        if (text) {
            try {
                data =
                    JSON.parse(
                        text
                    );

            } catch {
                throw new Error(
                    "O servidor retornou uma resposta inválida."
                );
            }
        }


        return {
            response,
            data,
        };

    } catch (error) {
        if (
            error?.name ===
            "AbortError"
        ) {
            throw new Error(
                "O servidor demorou para responder."
            );
        }


        throw error;

    } finally {
        clearTimeout(
            timeout
        );
    }
}


/*
 * =========================
 * CREDENCIAIS DO HOST
 * =========================
 */

function getHostCredentialsPath() {
    return path.join(
        app.getPath(
            "userData"
        ),
        "host-credentials.json"
    );
}


async function saveHostCredentials(
    channelId,
    hostSecret
) {
    if (
        !isValidChannelId(
            channelId
        ) ||
        !isValidSecret(
            hostSecret
        )
    ) {
        throw new Error(
            "Credenciais do host inválidas."
        );
    }


    if (
        !safeStorage
            .isEncryptionAvailable()
    ) {
        throw new Error(
            "O armazenamento seguro do Windows não está disponível."
        );
    }


    const encryptedSecret =
        safeStorage
            .encryptString(
                hostSecret
            )
            .toString(
                "base64"
            );


    const data = {
        version:
            1,

        channelId,

        encryptedHostSecret:
            encryptedSecret,
    };


    const credentialsPath =
        getHostCredentialsPath();


    await fs.promises
        .mkdir(
            path.dirname(
                credentialsPath
            ),
            {
                recursive:
                    true,
            }
        );


    await fs.promises
        .writeFile(
            credentialsPath,
            JSON.stringify(
                data
            ),
            {
                encoding:
                    "utf8",

                mode:
                    0o600,

                flag:
                    "w",
            }
        );


    return true;
}


async function loadHostCredentials() {
    const credentialsPath =
        getHostCredentialsPath();


    try {
        const stat =
            await fs.promises
                .stat(
                    credentialsPath
                )
                .catch(
                    () => null
                );


        if (!stat) {
            return null;
        }


        if (
            !stat.isFile() ||
            stat.size <=
            0 ||
            stat.size >
            HOST_CREDENTIALS_MAX_BYTES
        ) {
            return null;
        }


        if (
            !safeStorage
                .isEncryptionAvailable()
        ) {
            return null;
        }


        const raw =
            await fs.promises
                .readFile(
                    credentialsPath,
                    "utf8"
                );


        const data =
            JSON.parse(
                raw
            );


        if (
            data?.version !==
            1 ||
            !isValidChannelId(
                data.channelId
            ) ||
            typeof data
                .encryptedHostSecret !==
            "string" ||
            !data
                .encryptedHostSecret
        ) {
            return null;
        }


        const encryptedBuffer =
            Buffer.from(
                data.encryptedHostSecret,
                "base64"
            );


        const hostSecret =
            safeStorage
                .decryptString(
                    encryptedBuffer
                );


        if (
            !isValidSecret(
                hostSecret
            )
        ) {
            return null;
        }


        return {
            channelId:
                data.channelId,

            hostSecret,
        };

    } catch (error) {
        logMainError(
            "Falha ao ler credenciais protegidas",
            error
        );


        return null;
    }
}


/*
 * =========================
 * GARANTIR CHANNEL
 * =========================
 */

async function ensureHostChannel() {
    const credentials =
        await loadHostCredentials();


    if (credentials) {
        return {
            channelId:
                credentials.channelId,
        };
    }


    const {
        response,
        data,
    } =
        await fetchJson(
            `${API_URL}/channels`,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json",
                },
            }
        );


    if (!response.ok) {
        throw new Error(
            "Não foi possível criar o Channel."
        );
    }


    if (
        !isValidChannelId(
            data?.channelId
        ) ||
        !isValidSecret(
            data?.hostSecret
        )
    ) {
        throw new Error(
            "O servidor retornou credenciais inválidas."
        );
    }


    await saveHostCredentials(
        data.channelId,
        data.hostSecret
    );


    return {
        channelId:
            data.channelId,
    };
}


/*
 * =========================
 * INICIAR SESSION
 * =========================
 */

async function startHostSession(
    participantName,
    maxViewers =
        4
) {
    const credentials =
        await loadHostCredentials();


    if (!credentials) {
        throw new Error(
            "Credenciais do host não encontradas."
        );
    }


    const safeParticipantName =
        normalizeParticipantName(
            participantName
        );


    const safeMaxViewers =
        normalizeMaxViewers(
            maxViewers
        );


    const {
        response,
        data,
    } =
        await fetchJson(
            `${API_URL}/channels/${encodeURIComponent(
                credentials.channelId
            )}/start`,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json",
                },

                body:
                    JSON.stringify({
                        hostSecret:
                            credentials.hostSecret,

                        participantName:
                            safeParticipantName,

                        maxViewers:
                            safeMaxViewers,
                    }),
            }
        );


    if (!response.ok) {
        throw new Error(
            data?.message ||
            data?.error ||
            "Não foi possível iniciar a sessão."
        );
    }


    const sessionId =
        data?.sessionId;


    if (
        isValidSessionId(
            sessionId
        )
    ) {
        activeHostSessionId =
            sessionId;
    }


    const validResponse =
        isValidSessionId(
            sessionId
        ) &&
        isValidLiveKitUrl(
            data?.serverUrl
        ) &&
        typeof data?.token ===
        "string" &&
        data.token.length >
        0 &&
        data.token.length <=
        16_384 &&
        isValidSecret(
            data?.viewerAccess
        ) &&
        Number.isInteger(
            Number(
                data?.maxViewers
            )
        ) &&
        Number(
            data.maxViewers
        ) >=
        MIN_VIEWERS &&
        Number(
            data.maxViewers
        ) <=
        MAX_VIEWERS;


    if (!validResponse) {
        if (
            activeHostSessionId
        ) {
            await endHostSession(
                END_SESSION_TIMEOUT_MS
            ).catch(
                () => {
                    /*
                     * Falha de limpeza.
                     */
                }
            );
        }


        throw new Error(
            "O servidor retornou dados inválidos para a transmissão."
        );
    }


    return {
        channelId:
            credentials.channelId,

        sessionId:
            data.sessionId,

        serverUrl:
            data.serverUrl,

        token:
            data.token,

        viewerAccess:
            data.viewerAccess,

        maxViewers:
            Number(
                data.maxViewers
            ),
    };
}


/*
 * =========================
 * ENCERRAR SESSION
 * =========================
 */

async function endHostSession(
    timeoutMs =
        REQUEST_TIMEOUT_MS
) {
    const credentials =
        await loadHostCredentials();


    if (!credentials) {
        return false;
    }


    if (
        !activeHostSessionId
    ) {
        return true;
    }


    if (
        !isValidSessionId(
            activeHostSessionId
        )
    ) {
        activeHostSessionId =
            null;


        return false;
    }


    const sessionId =
        activeHostSessionId;


    const {
        response,
        data,
    } =
        await fetchJson(
            `${API_URL}/channels/${encodeURIComponent(
                credentials.channelId
            )}/end`,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json",
                },

                body:
                    JSON.stringify({
                        hostSecret:
                            credentials.hostSecret,

                        sessionId,
                    }),
            },
            timeoutMs
        );


    if (
        response.status ===
        409 &&
        (
            data?.code ===
            "SESSION_MISMATCH" ||
            data?.error ===
            "SESSION_MISMATCH"
        )
    ) {
        activeHostSessionId =
            null;


        return false;
    }


    if (!response.ok) {
        throw new Error(
            data?.error ||
            "Não foi possível finalizar a sessão."
        );
    }


    if (
        activeHostSessionId ===
        sessionId
    ) {
        activeHostSessionId =
            null;
    }


    return true;
}


/*
 * =========================
 * RENDERER DE PRODUÇÃO
 * =========================
 */

function getProductionRendererUrl() {
    return pathToFileURL(
        path.join(
            __dirname,
            "dist",
            "index.html"
        )
    );
}


/*
 * =========================
 * IPC CONFIÁVEL
 * =========================
 */

function isTrustedRendererUrl(
    value
) {
    try {
        const parsed =
            new URL(
                value
            );


        if (
            app.isPackaged
        ) {
            const expectedUrl =
                getProductionRendererUrl();


            return (
                parsed.protocol ===
                "file:" &&
                parsed.pathname ===
                expectedUrl.pathname
            );
        }


        return (
            parsed.origin ===
            DEVELOPMENT_RENDERER_URL
        );

    } catch {
        return false;
    }
}


function assertTrustedRendererEvent(
    event
) {
    if (
        !mainWindow ||
        mainWindow.isDestroyed()
    ) {
        throw new Error(
            "Janela principal indisponível."
        );
    }


    if (
        event.sender !==
        mainWindow.webContents
    ) {
        throw new Error(
            "IPC não autorizado."
        );
    }


    const frameUrl =
        event.senderFrame
            ?.url ||
        "";


    if (
        !isTrustedRendererUrl(
            frameUrl
        )
    ) {
        throw new Error(
            "Origem IPC não autorizada."
        );
    }
}


/*
 * =========================
 * COMPATIBILIDADE WINDOW AUDIO
 * =========================
 */

function getWindowAudioSupport() {
    const platform =
        process.platform;


    const version =
        os.release();


    if (
        platform !==
        "win32"
    ) {
        return {
            supported:
                false,

            platform,

            version,

            build:
                null,

            minimumBuild:
                MIN_WINDOW_AUDIO_BUILD,

            reason:
                "O áudio exclusivo por janela está disponível apenas no Windows.",
        };
    }


    const parts =
        version.split(
            "."
        );


    const build =
        Number(
            parts[2]
        );


    if (
        !Number.isInteger(
            build
        )
    ) {
        return {
            supported:
                false,

            platform,

            version,

            build:
                null,

            minimumBuild:
                MIN_WINDOW_AUDIO_BUILD,

            reason:
                "Não foi possível identificar a versão do Windows.",
        };
    }


    const supported =
        build >=
        MIN_WINDOW_AUDIO_BUILD;


    return {
        supported,

        platform,

        version,

        build,

        minimumBuild:
            MIN_WINDOW_AUDIO_BUILD,

        reason:
            supported
                ? null
                : `O áudio exclusivo por janela requer Windows build ${MIN_WINDOW_AUDIO_BUILD} ou superior.`,
    };
}


/*
 * =========================
 * EXTRAIR HWND
 * =========================
 */

function getWindowHandleFromSourceId(
    sourceId
) {
    if (
        typeof sourceId !==
        "string"
    ) {
        return null;
    }


    const match =
        sourceId.match(
            /^window:(\d+):\d+$/
        );


    if (!match) {
        return null;
    }


    return match[1];
}


/*
 * =========================
 * HWND → PID
 * =========================
 */

async function getProcessIdFromWindowSource(
    sourceId
) {
    if (
        process.platform !==
        "win32"
    ) {
        return null;
    }


    const hwnd =
        getWindowHandleFromSourceId(
            sourceId
        );


    if (!hwnd) {
        return null;
    }


    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class ShareRoomWin32
{
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(
        IntPtr hWnd,
        out uint lpdwProcessId
    );
}
"@

$hwnd = [IntPtr]::new([Int64]${hwnd})

[uint32]$processId = 0

[void][ShareRoomWin32]::GetWindowThreadProcessId(
    $hwnd,
    [ref]$processId
)

Write-Output $processId
`;


    try {
        const {
            stdout,
        } =
            await execFileAsync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    script,
                ],
                {
                    windowsHide:
                        true,

                    timeout:
                        5_000,

                    maxBuffer:
                        64 * 1024,
                }
            );


        const pid =
            Number(
                stdout.trim()
            );


        if (
            !Number.isInteger(
                pid
            ) ||
            pid <=
            0
        ) {
            return null;
        }


        return pid;

    } catch (error) {
        logMainError(
            "Falha ao identificar processo da janela",
            error
        );


        return null;
    }
}


/*
 * =========================
 * CAMINHO DO HELPER
 * =========================
 */

function getAudioHelperPath() {
    if (
        !app.isPackaged
    ) {
        return path.join(
            __dirname,
            "native",
            "shareroom-audio",
            "x64",
            "Release",
            "ApplicationLoopback.exe"
        );
    }


    return path.join(
        process.resourcesPath,
        "native",
        "ApplicationLoopback.exe"
    );
}


/*
 * =========================
 * PARAR ÁUDIO NATIVO
 * =========================
 */

async function stopNativeAudioCapture() {
    const child =
        nativeAudioProcess;


    if (!child) {
        nativeAudioKey =
            null;


        return true;
    }


    if (
        nativeAudioProcess ===
        child
    ) {
        nativeAudioProcess =
            null;


        nativeAudioKey =
            null;
    }


    return new Promise(
        (resolve) => {

            let finished =
                false;

            let timer =
                null;


            const finish =
                () => {

                    if (finished) {
                        return;
                    }


                    finished =
                        true;


                    if (timer) {
                        clearTimeout(
                            timer
                        );
                    }


                    resolve(
                        true
                    );
                };


            child.once(
                "exit",
                finish
            );


            try {
                if (
                    child.stdin &&
                    !child.stdin.destroyed
                ) {
                    child.stdin.write(
                        "stop\n"
                    );
                }

            } catch {
                /*
                 * O kill abaixo continua
                 * sendo o fallback.
                 */
            }


            timer =
                setTimeout(
                    () => {

                        if (
                            child.exitCode ===
                            null
                        ) {
                            try {
                                child.kill();
                            } catch {
                                /*
                                 * Processo já pode
                                 * ter encerrado.
                                 */
                            }
                        }


                        finish();

                    },
                    1200
                );


            if (
                child.exitCode !==
                null
            ) {
                finish();
            }
        }
    );
}


/*
 * =========================
 * PARADA FORÇADA
 * =========================
 */

function forceStopNativeAudioCapture() {
    const child =
        nativeAudioProcess;


    nativeAudioProcess =
        null;


    nativeAudioKey =
        null;


    if (!child) {
        return;
    }


    try {
        if (
            child.stdin &&
            !child.stdin.destroyed
        ) {
            child.stdin.write(
                "stop\n"
            );
        }

    } catch {
        /*
         * Processo pode já
         * estar encerrando.
         */
    }


    try {
        if (
            child.exitCode ===
            null
        ) {
            child.kill();
        }

    } catch {
        /*
         * Processo pode já
         * estar encerrado.
         */
    }
}


/*
 * =========================
 * AGUARDAR HELPER
 * =========================
 */

async function waitForAudioHelperReady(
    child,
    expectedReady
) {
    return await new Promise(
        (resolve) => {

            let finished =
                false;

            let timer =
                null;

            let stderrText =
                "";


            const finish =
                (result) => {

                    if (finished) {
                        return;
                    }


                    finished =
                        true;


                    if (timer) {
                        clearTimeout(
                            timer
                        );
                    }


                    child.stderr
                        ?.off(
                            "data",
                            onData
                        );


                    child.off(
                        "error",
                        onError
                    );


                    child.off(
                        "exit",
                        onExit
                    );


                    resolve(
                        result
                    );
                };


            const onData =
                (chunk) => {

                    if (
                        !Buffer.isBuffer(
                            chunk
                        ) ||
                        chunk.length ===
                        0
                    ) {
                        return;
                    }


                    stderrText +=
                        chunk.toString(
                            "utf8"
                        );


                    if (
                        stderrText.length >
                        4096
                    ) {
                        stderrText =
                            stderrText.slice(
                                -4096
                            );
                    }


                    if (
                        stderrText.includes(
                            expectedReady
                        )
                    ) {
                        finish(
                            true
                        );
                    }
                };


            const onError =
                () => {
                    finish(
                        false
                    );
                };


            const onExit =
                () => {
                    finish(
                        false
                    );
                };


            child.stderr
                ?.on(
                    "data",
                    onData
                );


            child.once(
                "error",
                onError
            );


            child.once(
                "exit",
                onExit
            );


            timer =
                setTimeout(
                    () => {
                        finish(
                            false
                        );
                    },
                    3000
                );
        }
    );
}


/*
 * =========================
 * INICIAR ÁUDIO NATIVO
 * =========================
 *
 * system:
 * ApplicationLoopback.exe --system
 *
 * window:
 * ApplicationLoopback.exe <pid>
 */

async function startNativeAudioCapture(
    audioMode,
    processId =
        null
) {
    if (
        process.platform !==
        "win32"
    ) {
        return false;
    }


    if (
        audioMode !==
        "system" &&
        audioMode !==
        "window"
    ) {
        return false;
    }


    if (
        audioMode ===
        "window"
    ) {
        const support =
            getWindowAudioSupport();


        if (
            !support.supported
        ) {
            return false;
        }


        if (
            !Number.isInteger(
                processId
            ) ||
            processId <=
            0
        ) {
            return false;
        }
    }


    const key =
        audioMode ===
        "system"
            ? "system"
            : `window:${processId}`;


    if (
        nativeAudioProcess &&
        nativeAudioKey ===
        key &&
        nativeAudioProcess.exitCode ===
        null
    ) {
        return true;
    }


    await stopNativeAudioCapture();


    const helperPath =
        path.resolve(
            getAudioHelperPath()
        );


    if (
        !fs.existsSync(
            helperPath
        )
    ) {
        return false;
    }


    const args =
        audioMode ===
        "system"
            ? [
                "--system",
            ]
            : [
                String(
                    processId
                ),
            ];


    const expectedReady =
        audioMode ===
        "system"
            ? "READY SYSTEM"
            : `READY PID=${processId}`;


    let child;


    try {
        child =
            spawn(
                helperPath,
                args,
                {
                    windowsHide:
                        true,

                    shell:
                        false,

                    stdio: [
                        "pipe",
                        "pipe",
                        "pipe",
                    ],
                }
            );

    } catch (error) {
        logMainError(
            "Falha ao iniciar áudio nativo",
            error
        );


        return false;
    }


    nativeAudioProcess =
        child;


    nativeAudioKey =
        key;


    /*
     * PCM do helper.
     */

    child.stdout.on(
        "data",
        (chunk) => {

            if (
                nativeAudioProcess !==
                child
            ) {
                return;
            }


            if (
                !Buffer.isBuffer(
                    chunk
                ) ||
                chunk.length ===
                0 ||
                chunk.length >
                1024 * 1024
            ) {
                return;
            }


            if (
                mainWindow &&
                !mainWindow.isDestroyed()
            ) {
                mainWindow
                    .webContents
                    .send(
                        "window-audio:pcm",
                        chunk
                    );
            }
        }
    );


    child.on(
        "error",
        (error) => {

            logMainError(
                "Erro no helper de áudio",
                error
            );


            if (
                nativeAudioProcess ===
                child
            ) {
                nativeAudioProcess =
                    null;


                nativeAudioKey =
                    null;
            }
        }
    );


    child.on(
        "exit",
        () => {

            if (
                nativeAudioProcess ===
                child
            ) {
                nativeAudioProcess =
                    null;


                nativeAudioKey =
                    null;
            }
        }
    );


    const ready =
        await waitForAudioHelperReady(
            child,
            expectedReady
        );


    if (!ready) {
        if (
            nativeAudioProcess ===
            child
        ) {
            await stopNativeAudioCapture();

        } else {
            try {
                if (
                    child.exitCode ===
                    null
                ) {
                    child.kill();
                }
            } catch {
                /*
                 * Processo já pode
                 * ter encerrado.
                 */
            }
        }


        return false;
    }


    /*
     * Mantém stderr drenado.
     */

    child.stderr.on(
        "data",
        () => {
            /*
             * Logs não são expostos
             * em produção.
             */
        }
    );


    return true;
}


/*
 * =========================
 * IPC — HOST
 * =========================
 */

ipcMain.handle(
    "host:ensureChannel",
    async (
        event
    ) => {

        assertTrustedRendererEvent(
            event
        );


        return await ensureHostChannel();
    }
);


ipcMain.handle(
    "host:startSession",
    async (
        event,
        payload
    ) => {

        assertTrustedRendererEvent(
            event
        );


        const participantName =
            normalizeParticipantName(
                payload
                    ?.participantName
            );


        const maxViewers =
            normalizeMaxViewers(
                payload
                    ?.maxViewers
            );


        return await startHostSession(
            participantName,
            maxViewers
        );
    }
);


ipcMain.handle(
    "host:endSession",
    async (
        event
    ) => {

        assertTrustedRendererEvent(
            event
        );


        return await endHostSession();
    }
);


/*
 * =========================
 * IPC — LISTAR FONTES
 * =========================
 */

ipcMain.handle(
    "desktop:getSources",
    async (
        event
    ) => {

        assertTrustedRendererEvent(
            event
        );


        const sources =
            await desktopCapturer
                .getSources({
                    types: [
                        "screen",
                        "window",
                    ],

                    thumbnailSize: {
                        width:
                            320,

                        height:
                            180,
                    },

                    fetchWindowIcons:
                        true,
                });


        return sources.map(
            (source) => ({

                id:
                    source.id,

                name:
                    String(
                        source.name ||
                        ""
                    )
                        .slice(
                            0,
                            300
                        ),

                displayId:
                    String(
                        source.display_id ||
                        ""
                    )
                        .slice(
                            0,
                            100
                        ),

                thumbnail:
                    source.thumbnail
                        .toDataURL(),

                appIcon:
                    source.appIcon
                        ? source.appIcon
                            .toDataURL()
                        : null,

                type:
                    source.id
                        .startsWith(
                            "screen:"
                        )
                        ? "screen"
                        : "window",
            })
        );
    }
);


/*
 * =========================
 * IPC — SUPORTE ÁUDIO
 * =========================
 */

ipcMain.handle(
    "window-audio:getSupport",
    async (
        event
    ) => {

        assertTrustedRendererEvent(
            event
        );


        return getWindowAudioSupport();
    }
);


/*
 * =========================
 * IPC — SELECIONAR FONTE
 * =========================
 */

ipcMain.handle(
    "desktop:setSelectedSource",
    async (
        event,
        payload
    ) => {

        assertTrustedRendererEvent(
            event
        );


        const requestedSourceId =
            payload
                ?.sourceId;


        const requestedAudioMode =
            payload
                ?.audioMode;


        if (
            !isValidSourceId(
                requestedSourceId
            )
        ) {
            throw new Error(
                "Fonte de captura inválida."
            );
        }


        if (
            requestedAudioMode !==
            "system" &&
            requestedAudioMode !==
            "window" &&
            requestedAudioMode !==
            "off"
        ) {
            throw new Error(
                "Modo de áudio inválido."
            );
        }


        const sources =
            await desktopCapturer
                .getSources({
                    types: [
                        "screen",
                        "window",
                    ],
                });


        const selectedSource =
            sources.find(
                (source) =>
                    source.id ===
                    requestedSourceId
            );


        if (!selectedSource) {
            throw new Error(
                "A tela ou janela selecionada não está mais disponível."
            );
        }


        const sourceType =
            selectedSource.id
                .startsWith(
                    "screen:"
                )
                ? "screen"
                : "window";


        if (
            sourceType ===
            "screen" &&
            requestedAudioMode ===
            "window"
        ) {
            throw new Error(
                "Modo de áudio incompatível com captura de tela."
            );
        }


        if (
            sourceType ===
            "window" &&
            requestedAudioMode ===
            "system"
        ) {
            throw new Error(
                "Modo de áudio incompatível com captura de janela."
            );
        }


        selectedSourceId =
            selectedSource.id;


        selectedAudioMode =
            requestedAudioMode;


        selectedProcessId =
            null;


        /*
         * JANELA → PID
         */

        if (
            sourceType ===
            "window"
        ) {
            selectedProcessId =
                await getProcessIdFromWindowSource(
                    selectedSource.id
                );
        }


        /*
         * =========================
         * ÁUDIO NATIVO
         * =========================
         */

        if (
            selectedAudioMode ===
            "window"
        ) {
            if (
                !selectedProcessId
            ) {
                selectedAudioMode =
                    "off";


                await stopNativeAudioCapture();


                throw new Error(
                    "Não foi possível identificar o processo da janela selecionada."
                );
            }


            const started =
                await startNativeAudioCapture(
                    "window",
                    selectedProcessId
                );


            if (!started) {
                selectedAudioMode =
                    "off";


                throw new Error(
                    "Não foi possível iniciar o áudio exclusivo desta janela."
                );
            }

        } else if (
            selectedAudioMode ===
            "system"
        ) {
            const started =
                await startNativeAudioCapture(
                    "system"
                );


            if (!started) {
                selectedAudioMode =
                    "off";


                throw new Error(
                    "Não foi possível iniciar o áudio do sistema."
                );
            }

        } else {
            await stopNativeAudioCapture();
        }


        return true;
    }
);


/*
 * =========================
 * IPC — PARAR ÁUDIO NATIVO
 * =========================
 */

ipcMain.handle(
    "window-audio:stop",
    async (
        event
    ) => {

        assertTrustedRendererEvent(
            event
        );


        selectedAudioMode =
            "off";


        selectedProcessId =
            null;


        await stopNativeAudioCapture();


        return true;
    }
);


/*
 * =========================
 * NAVEGAÇÃO PERMITIDA
 * =========================
 */

function isAllowedNavigation(
    targetUrl
) {
    try {
        const parsed =
            new URL(
                targetUrl
            );


        if (
            app.isPackaged
        ) {
            const expectedUrl =
                getProductionRendererUrl();


            return (
                parsed.protocol ===
                "file:" &&
                parsed.pathname ===
                expectedUrl.pathname
            );
        }


        return (
            parsed.origin ===
            DEVELOPMENT_RENDERER_URL
        );

    } catch {
        return false;
    }
}


/*
 * =========================
 * JANELA PRINCIPAL
 * =========================
 */

function createWindow() {
    mainWindow =
        new BrowserWindow({
            width:
                1100,

            height:
                700,

            minWidth:
                800,

            minHeight:
                500,

            backgroundColor:
                "#111111",

            icon:
                fs.existsSync(
                    WINDOW_ICON_PATH
                )
                    ? WINDOW_ICON_PATH
                    : undefined,

            autoHideMenuBar:
                true,

            show:
                false,

            webPreferences: {
                preload:
                    path.join(
                        __dirname,
                        "preload.js"
                    ),

                contextIsolation:
                    true,

                nodeIntegration:
                    false,

                sandbox:
                    true,

                webSecurity:
                    true,

                allowRunningInsecureContent:
                    false,

                webviewTag:
                    false,

                spellcheck:
                    false,

                devTools:
                    !app.isPackaged,
            },
        });


    if (
        app.isPackaged
    ) {
        Menu.setApplicationMenu(
            null
        );


        mainWindow
            .removeMenu();
    }


    mainWindow
        .webContents
        .setWindowOpenHandler(
            () => ({
                action:
                    "deny",
            })
        );


    mainWindow
        .webContents
        .on(
            "will-attach-webview",
            (
                event
            ) => {

                event
                    .preventDefault();
            }
        );


    mainWindow
        .webContents
        .on(
            "will-navigate",
            (
                event,
                navigationUrl
            ) => {

                if (
                    !isAllowedNavigation(
                        navigationUrl
                    )
                ) {
                    event
                        .preventDefault();
                }
            }
        );


    mainWindow
        .webContents
        .on(
            "will-redirect",
            (
                event,
                navigationUrl
            ) => {

                if (
                    !isAllowedNavigation(
                        navigationUrl
                    )
                ) {
                    event
                        .preventDefault();
                }
            }
        );


    if (
        app.isPackaged
    ) {
        mainWindow
            .webContents
            .on(
                "before-input-event",
                (
                    event,
                    input
                ) => {

                    const key =
                        input.key
                            ?.toLowerCase();


                    const isF12 =
                        key ===
                        "f12";


                    const isDevToolsShortcut =
                        input.control &&
                        input.shift &&
                        key ===
                        "i";


                    if (
                        isF12 ||
                        isDevToolsShortcut
                    ) {
                        event
                            .preventDefault();
                    }
                }
            );
    }


    mainWindow
        .webContents
        .on(
            "render-process-gone",
            () => {

                selectedSourceId =
                    null;


                selectedAudioMode =
                    "off";


                selectedProcessId =
                    null;


                void endHostSession(
                    END_SESSION_TIMEOUT_MS
                )
                    .catch(
                        () => {
                            /*
                             * Cleanup.
                             */
                        }
                    );


                void stopNativeAudioCapture();
            }
        );


    if (
        app.isPackaged
    ) {
        mainWindow
            .loadFile(
                path.join(
                    __dirname,
                    "dist",
                    "index.html"
                )
            );

    } else {
        mainWindow
            .loadURL(
                DEVELOPMENT_RENDERER_URL
            );
    }


    mainWindow
        .once(
            "ready-to-show",
            () => {

                if (
                    !mainWindow ||
                    mainWindow.isDestroyed()
                ) {
                    return;
                }


                if (
                    app.isPackaged
                ) {
                    mainWindow
                        .maximize();
                }


                mainWindow
                    .show();
            }
        );


    mainWindow
        .on(
            "closed",
            () => {

                mainWindow =
                    null;


                selectedSourceId =
                    null;


                selectedAudioMode =
                    "off";


                selectedProcessId =
                    null;


                void stopNativeAudioCapture();


                void endHostSession(
                    END_SESSION_TIMEOUT_MS
                )
                    .catch(
                        () => {
                            /*
                             * Cleanup.
                             */
                        }
                    );
            }
        );
}


/*
 * =========================
 * ELECTRON READY
 * =========================
 */

app.whenReady()
    .then(
        () => {

            session
                .defaultSession
                .setDisplayMediaRequestHandler(
                    async (
                        request,
                        callback
                    ) => {

                        if (
                            !mainWindow ||
                            mainWindow.isDestroyed() ||
                            (
                                request.frame &&
                                request.frame !==
                                mainWindow
                                    .webContents
                                    .mainFrame
                            )
                        ) {
                            callback(
                                {}
                            );


                            return;
                        }


                        if (
                            !selectedSourceId
                        ) {
                            callback(
                                {}
                            );


                            return;
                        }


                        const sources =
                            await desktopCapturer
                                .getSources({
                                    types: [
                                        "screen",
                                        "window",
                                    ],
                                });


                        const selectedSource =
                            sources.find(
                                (source) =>
                                    source.id ===
                                    selectedSourceId
                            );


                        if (
                            !selectedSource
                        ) {
                            callback(
                                {}
                            );


                            return;
                        }


                        callback({
                            video:
                                selectedSource,
                        });
                    }
                );


            createWindow();


            app.on(
                "activate",
                () => {

                    if (
                        BrowserWindow
                            .getAllWindows()
                            .length ===
                        0
                    ) {
                        createWindow();
                    }
                }
            );
        }
    )
    .catch(
        (error) => {

            logMainError(
                "Falha ao iniciar Electron",
                error
            );


            app.exit(
                1
            );
        }
    );


/*
 * =========================
 * ENCERRAMENTO SEGURO
 * =========================
 */

app.on(
    "before-quit",
    (
        event
    ) => {

        if (
            shutdownComplete
        ) {
            return;
        }


        event
            .preventDefault();


        if (
            shutdownStarted
        ) {
            return;
        }


        shutdownStarted =
            true;


        void (
            async () => {

                try {
                    await Promise.allSettled([
                        endHostSession(
                            END_SESSION_TIMEOUT_MS
                        ),

                        stopNativeAudioCapture(),
                    ]);

                } finally {
                    shutdownComplete =
                        true;


                    app.quit();
                }
            }
        )();
    }
);


/*
 * =========================
 * ÚLTIMA PROTEÇÃO
 * =========================
 */

app.on(
    "will-quit",
    () => {

        forceStopNativeAudioCapture();
    }
);


/*
 * =========================
 * TODAS AS JANELAS FECHADAS
 * =========================
 */

app.on(
    "window-all-closed",
    () => {

        if (
            process.platform !==
            "darwin"
        ) {
            app.quit();
        }
    }
);