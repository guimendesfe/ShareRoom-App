import {
    useEffect,
    useRef,
    useState,
} from "react";

import {
    Room,
    RoomEvent,
    Track,
} from "livekit-client";


type SourceType =
    | "screen"
    | "window";


type WindowAudioSupport = {
    supported: boolean;
    platform: string;
    version: string;
    build: number | null;
    minimumBuild: number;
    reason: string | null;
};


type DesktopSource = {
    id: string;
    name: string;
    displayId: string;
    thumbnail: string;
    appIcon: string | null;
    type: SourceType;
};


type HostSessionData = {
    channelId: string;
    sessionId: string;
    serverUrl: string;
    token: string;
    viewerAccess: string;
    maxViewers: number;
};


type AppView =
    | "home"
    | "select"
    | "preview"
    | "live"
    | "change-source";


type StreamQuality =
    | "720p"
    | "1080p";


type StreamFps =
    | 30
    | 60;


type StreamSettings = {
    quality: StreamQuality;
    fps: StreamFps;
    audioEnabled: boolean;
};


type AudioMode =
    | "off"
    | "system"
    | "window";


const CHANNEL_ID_PATTERN =
    /^[A-Za-z0-9_-]{12}$/;


const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


const SECRET_PATTERN =
    /^[A-Za-z0-9_-]{32,128}$/;


const MAX_VIEWERS_OPTIONS =
    [
        1,
        2,
        4,
        6,
        8,
        12,
    ] as const;


const MAX_SOURCE_COUNT =
    200;


const MAX_IMAGE_DATA_URL_LENGTH =
    2_000_000;


/*
 * =========================
 * UTILITÁRIOS
 * =========================
 */

function isRecord(
    value: unknown
): value is Record<string, unknown> {
    return (
        typeof value ===
        "object" &&
        value !==
        null
    );
}


function getSafeErrorMessage(
    error: unknown,
    fallback: string
) {
    if (
        !(error instanceof Error)
    ) {
        return fallback;
    }


    const message =
        error.message
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
                300
            );


    return (
        message ||
        fallback
    );
}


function isSafeImageDataUrl(
    value: unknown
): value is string {
    return (
        typeof value ===
        "string" &&
        value.length >
        0 &&
        value.length <=
        MAX_IMAGE_DATA_URL_LENGTH &&
        value.startsWith(
            "data:image/png;base64,"
        )
    );
}


function sanitizeDesktopSources(
    value: unknown
): DesktopSource[] {
    if (
        !Array.isArray(
            value
        )
    ) {
        throw new Error(
            "A lista de telas retornada pelo Electron é inválida."
        );
    }


    const result:
        DesktopSource[] =
        [];


    for (
        const item of value
            .slice(
                0,
                MAX_SOURCE_COUNT
            )
    ) {
        if (
            !isRecord(
                item
            )
        ) {
            continue;
        }


        const {
            id,
            name,
            displayId,
            thumbnail,
            appIcon,
            type,
        } =
            item;


        if (
            typeof id !==
            "string" ||
            id.length ===
            0 ||
            id.length >
            512
        ) {
            continue;
        }


        if (
            type !==
            "screen" &&
            type !==
            "window"
        ) {
            continue;
        }


        if (
            type ===
            "screen" &&
            !id.startsWith(
                "screen:"
            )
        ) {
            continue;
        }


        if (
            type ===
            "window" &&
            !id.startsWith(
                "window:"
            )
        ) {
            continue;
        }


        if (
            typeof name !==
            "string" ||
            name.length >
            300
        ) {
            continue;
        }


        if (
            typeof displayId !==
            "string" ||
            displayId.length >
            100
        ) {
            continue;
        }


        if (
            !isSafeImageDataUrl(
                thumbnail
            )
        ) {
            continue;
        }


        if (
            appIcon !==
            null &&
            !isSafeImageDataUrl(
                appIcon
            )
        ) {
            continue;
        }


        result.push({
            id,
            name,
            displayId,
            thumbnail,
            appIcon:
                appIcon as
                string | null,
            type,
        });
    }


    return result;
}


function sanitizeWindowAudioSupport(
    value: unknown
): WindowAudioSupport {
    if (
        !isRecord(
            value
        )
    ) {
        throw new Error(
            "Informações de compatibilidade de áudio inválidas."
        );
    }


    const {
        supported,
        platform,
        version,
        build,
        minimumBuild,
        reason,
    } =
        value;


    if (
        typeof supported !==
        "boolean" ||
        typeof platform !==
        "string" ||
        platform.length >
        50 ||
        typeof version !==
        "string" ||
        version.length >
        100 ||
        (
            build !==
            null &&
            (
                typeof build !==
                "number" ||
                !Number.isInteger(
                    build
                )
            )
        ) ||
        typeof minimumBuild !==
        "number" ||
        !Number.isInteger(
            minimumBuild
        ) ||
        (
            reason !==
            null &&
            typeof reason !==
            "string"
        )
    ) {
        throw new Error(
            "Informações de compatibilidade de áudio inválidas."
        );
    }


    return {
        supported,
        platform,
        version,
        build,
        minimumBuild,
        reason:
            reason ===
                null
                ? null
                : reason.slice(
                    0,
                    300
                ),
    };
}


function sanitizeChannelId(
    value: unknown
) {
    if (
        typeof value !==
        "string" ||
        !CHANNEL_ID_PATTERN.test(
            value
        )
    ) {
        throw new Error(
            "O Electron retornou um Channel inválido."
        );
    }


    return value;
}


function isValidLiveKitUrl(
    value: unknown
) {
    if (
        typeof value !==
        "string"
    ) {
        return false;
    }


    try {
        const url =
            new URL(
                value
            );


        if (
            url.protocol ===
            "wss:"
        ) {
            return true;
        }


        return (
            import.meta.env.DEV &&
            url.protocol ===
            "ws:"
        );

    } catch {
        return false;
    }
}


function sanitizeHostSession(
    value: unknown,
    expectedChannelId: string
): HostSessionData {
    if (
        !isRecord(
            value
        )
    ) {
        throw new Error(
            "O Electron retornou uma Session inválida."
        );
    }


    const {
        channelId,
        sessionId,
        serverUrl,
        token,
        viewerAccess,
        maxViewers,
    } =
        value;


    if (
        typeof channelId !==
        "string" ||
        channelId !==
        expectedChannelId ||
        !CHANNEL_ID_PATTERN.test(
            channelId
        )
    ) {
        throw new Error(
            "O Channel retornado para a transmissão é inválido."
        );
    }


    if (
        typeof sessionId !==
        "string" ||
        !UUID_PATTERN.test(
            sessionId
        )
    ) {
        throw new Error(
            "A Session retornada para a transmissão é inválida."
        );
    }


    if (
        !isValidLiveKitUrl(
            serverUrl
        )
    ) {
        throw new Error(
            "O endereço do servidor de transmissão é inválido."
        );
    }


    if (
        typeof token !==
        "string" ||
        token.length ===
        0 ||
        token.length >
        16_384
    ) {
        throw new Error(
            "O token de transmissão é inválido."
        );
    }


    if (
        typeof viewerAccess !==
        "string" ||
        !SECRET_PATTERN.test(
            viewerAccess
        )
    ) {
        throw new Error(
            "O convite da transmissão é inválido."
        );
    }


    if (
        typeof maxViewers !==
        "number" ||
        !Number.isInteger(
            maxViewers
        ) ||
        !MAX_VIEWERS_OPTIONS.includes(
            maxViewers as
            typeof MAX_VIEWERS_OPTIONS[number]
        )
    ) {
        throw new Error(
            "O limite de espectadores retornado é inválido."
        );
    }


    return {
        channelId,
        sessionId,
        serverUrl:
            serverUrl as string,
        token,
        viewerAccess,
        maxViewers,
    };
}


/*
 * =========================
 * VIEWER URL
 * =========================
 */

function resolveViewerBaseUrl() {
    const fallback =
        import.meta.env.DEV
            ? "http://localhost:5174"
            : "https://share-room-viewer.vercel.app";


    const configured =
        import.meta.env.VITE_VIEWER_URL ||
        fallback;


    try {
        const url =
            new URL(
                configured
            );


        const validProtocol =
            import.meta.env.DEV
                ? (
                    url.protocol ===
                    "http:" ||
                    url.protocol ===
                    "https:"
                )
                : (
                    url.protocol ===
                    "https:"
                );


        if (
            !validProtocol
        ) {
            return fallback;
        }


        return url.origin;

    } catch {
        return fallback;
    }
}


const VIEWER_BASE_URL =
    resolveViewerBaseUrl();


function buildShareLink(
    sessionData: HostSessionData
) {
    const url =
        new URL(
            `/s/${encodeURIComponent(
                sessionData.channelId
            )}`,
            VIEWER_BASE_URL
        );


    url.searchParams.set(
        "session",
        sessionData.sessionId
    );


    const hash =
        new URLSearchParams({
            access:
                sessionData.viewerAccess,
        });


    url.hash =
        hash.toString();


    return url.toString();
}


/*
 * =========================
 * APP
 * =========================
 */

export default function App() {
    const [sourceFilter, setSourceFilter] = useState<"all" | SourceType>("all");
    const [sourceSearch, setSourceSearch] = useState("");
    const [
        viewerCount,
        setViewerCount,
    ] =
        useState(
            0
        );


    const [
        windowAudioSupport,
        setWindowAudioSupport,
    ] =
        useState<WindowAudioSupport | null>(
            null
        );


    const [
        pendingSource,
        setPendingSource,
    ] =
        useState<DesktopSource | null>(
            null
        );


    const [
        isSwitchingSource,
        setIsSwitchingSource,
    ] =
        useState(
            false
        );


    const [
        streamSettings,
        setStreamSettings,
    ] =
        useState<StreamSettings>({
            quality:
                "1080p",

            fps:
                60,

            audioEnabled:
                true,
        });


    const [
        draftSettings,
        setDraftSettings,
    ] =
        useState<StreamSettings>({
            quality:
                "1080p",

            fps:
                60,

            audioEnabled:
                true,
        });


    const [
        maxViewers,
        setMaxViewers,
    ] =
        useState(
            4
        );


    const [
        draftMaxViewers,
        setDraftMaxViewers,
    ] =
        useState(
            4
        );


    const [
        settingsOpen,
        setSettingsOpen,
    ] =
        useState(
            false
        );


    const [
        isApplyingSettings,
        setIsApplyingSettings,
    ] =
        useState(
            false
        );


    const [
        view,
        setView,
    ] =
        useState<AppView>(
            "home"
        );


    const [
        sources,
        setSources,
    ] =
        useState<DesktopSource[]>(
            []
        );


    const [
        selectedSource,
        setSelectedSource,
    ] =
        useState<DesktopSource | null>(
            null
        );


    const [
        loading,
        setLoading,
    ] =
        useState(
            false
        );


    const [
        error,
        setError,
    ] =
        useState(
            ""
        );


    const [
        isCapturing,
        setIsCapturing,
    ] =
        useState(
            false
        );


    const [
        isPublishing,
        setIsPublishing,
    ] =
        useState(
            false
        );


    const [
        isStoppingTransmission,
        setIsStoppingTransmission,
    ] =
        useState(
            false
        );


    const [
        channelId,
        setChannelId,
    ] =
        useState(
            ""
        );


    const [
        shareLink,
        setShareLink,
    ] =
        useState(
            ""
        );


    const [
        linkCopied,
        setLinkCopied,
    ] =
        useState(
            false
        );


    /*
     * =========================
     * REFS
     * =========================
     */

    const videoRef =
        useRef<HTMLVideoElement | null>(
            null
        );


    const streamRef =
        useRef<MediaStream | null>(
            null
        );


    const roomRef =
        useRef<Room | null>(
            null
        );


    const nativeAudioContextRef =
        useRef<AudioContext | null>(
            null
        );


    const nativeAudioNodeRef =
        useRef<AudioWorkletNode | null>(
            null
        );


    const nativeAudioTrackRef =
        useRef<MediaStreamTrack | null>(
            null
        );


    const publishedAudioTrackRef =
        useRef<MediaStreamTrack | null>(
            null
        );


    const transmissionActiveRef =
        useRef(
            false
        );


    const stoppingTransmissionRef =
        useRef(
            false
        );


    const copyTimeoutRef =
        useRef<number | null>(
            null
        );


    /*
     * =========================
     * PRÉVIA LOCAL
     * =========================
     */

    useEffect(
        () => {

            if (
                isCapturing &&
                videoRef.current &&
                streamRef.current
            ) {
                videoRef.current.srcObject =
                    streamRef.current;


                void videoRef.current
                    .play()
                    .catch(
                        () => {
                            // Preview local muted.
                        }
                    );
            }

        },
        [
            isCapturing,
            view,
        ]
    );


    /*
     * =========================
     * NATIVE AUDIO PCM
     * =========================
     */

    useEffect(
        () => {

            const removePCMListener =
                window
                    .electronAPI
                    .onWindowAudioPCM(
                        (
                            data
                        ) => {

                            const node =
                                nativeAudioNodeRef
                                    .current;


                            if (!node) {
                                return;
                            }


                            if (
                                !(data instanceof Uint8Array) ||
                                data.byteLength ===
                                0
                            ) {
                                return;
                            }


                            const copy =
                                new Uint8Array(
                                    data.byteLength
                                );


                            copy.set(
                                data
                            );


                            node.port
                                .postMessage(
                                    {
                                        type:
                                            "pcm",

                                        buffer:
                                            copy.buffer,
                                    },
                                    [
                                        copy.buffer,
                                    ]
                                );
                        }
                    );


            return () => {
                removePCMListener();


                void destroyNativeAudioTrack();
            };

        },
        []
    );


    /*
     * =========================
     * CHANNEL INICIAL
     * =========================
     */

    useEffect(
        () => {

            void ensureChannel();

        },
        []
    );


    /*
     * =========================
     * CLEANUP
     * =========================
     */

    useEffect(
        () => {

            return () => {

                transmissionActiveRef.current =
                    false;


                if (
                    copyTimeoutRef.current !==
                    null
                ) {
                    window.clearTimeout(
                        copyTimeoutRef.current
                    );
                }


                const room =
                    roomRef.current;


                roomRef.current =
                    null;


                if (room) {
                    void room.disconnect();
                }


                void window
                    .electronAPI
                    .stopWindowAudio()
                    .catch(
                        () => {
                            // Cleanup.
                        }
                    );


                void destroyNativeAudioTrack();
            };

        },
        []
    );


    /*
     * =========================
     * CONTADOR
     * =========================
     */

    function updateViewerCount(
        room: Room
    ) {
        setViewerCount(
            room.remoteParticipants
                .size
        );
    }


    /*
     * =========================
     * CHANNEL
     * =========================
     */

    async function ensureChannel():
        Promise<string | null> {

        try {
            const result =
                await window
                    .electronAPI
                    .ensureHostChannel();


            const safeChannelId =
                sanitizeChannelId(
                    result?.channelId
                );


            setChannelId(
                safeChannelId
            );


            setShareLink(
                ""
            );


            return safeChannelId;

        } catch (err) {
            setError(
                getSafeErrorMessage(
                    err,
                    "Não foi possível preparar o ShareRoom."
                )
            );


            return null;
        }
    }


    /*
     * =========================
     * WINDOW AUDIO SUPPORT
     * =========================
     */

    async function loadWindowAudioSupport():
        Promise<WindowAudioSupport> {

        const result =
            await window
                .electronAPI
                .getWindowAudioSupport();


        const support =
            sanitizeWindowAudioSupport(
                result
            );


        setWindowAudioSupport(
            support
        );


        return support;
    }


    /*
     * =========================
     * NATIVE AUDIO TRACK
     * =========================
     */

    async function prepareNativeAudioTrack():
        Promise<MediaStreamTrack> {

        if (
            nativeAudioTrackRef.current &&
            nativeAudioTrackRef.current
                .readyState ===
            "live"
        ) {
            return nativeAudioTrackRef
                .current;
        }


        await destroyNativeAudioTrack();


        const audioContext =
            new AudioContext({
                sampleRate:
                    44100,
            });


        try {
            await audioContext
                .audioWorklet
                .addModule(
                    "./window-audio-processor.js"
                );


            const workletNode =
                new AudioWorkletNode(
                    audioContext,
                    "window-audio-processor",
                    {
                        numberOfInputs:
                            0,

                        numberOfOutputs:
                            1,

                        outputChannelCount:
                            [
                                2,
                            ],
                    }
                );


            const destination =
                audioContext
                    .createMediaStreamDestination();


            workletNode.connect(
                destination
            );


            const audioTrack =
                destination
                    .stream
                    .getAudioTracks()[0];


            if (!audioTrack) {
                workletNode.disconnect();


                throw new Error(
                    "Não foi possível criar a track de áudio nativo."
                );
            }


            if (
                audioContext.state ===
                "suspended"
            ) {
                await audioContext
                    .resume();
            }


            nativeAudioContextRef.current =
                audioContext;


            nativeAudioNodeRef.current =
                workletNode;


            nativeAudioTrackRef.current =
                audioTrack;


            return audioTrack;

        } catch (error) {
            await audioContext
                .close()
                .catch(
                    () => {
                        // Cleanup.
                    }
                );


            throw error;
        }
    }


    async function destroyNativeAudioTrack() {
        const node =
            nativeAudioNodeRef.current;


        nativeAudioNodeRef.current =
            null;


        if (node) {
            try {
                node.disconnect();
            } catch {
                // Já desconectado.
            }
        }


        const track =
            nativeAudioTrackRef.current;


        nativeAudioTrackRef.current =
            null;


        if (track) {
            try {
                track.stop();
            } catch {
                // Já encerrada.
            }
        }


        const context =
            nativeAudioContextRef.current;


        nativeAudioContextRef.current =
            null;


        if (
            context &&
            context.state !==
            "closed"
        ) {
            await context
                .close()
                .catch(
                    () => {
                        // Cleanup.
                    }
                );
        }
    }


    /*
     * =========================
     * AUDIO MODE
     * =========================
     */

    function getAudioMode(
        source: DesktopSource,
        settings: StreamSettings
    ): AudioMode {

        if (
            !settings.audioEnabled
        ) {
            return "off";
        }


        if (
            source.type ===
            "screen"
        ) {
            return "system";
        }


        if (
            windowAudioSupport &&
            !windowAudioSupport
                .supported
        ) {
            return "off";
        }


        return "window";
    }



    /*
     * =========================
     * RESOLVER TRACK DE ÁUDIO
     * =========================
     */

    async function resolveAudioTrack(
        source: DesktopSource,
        settings: StreamSettings
    ): Promise<MediaStreamTrack | null> {

        const audioMode =
            getAudioMode(
                source,
                settings
            );


        if (
            audioMode ===
            "off"
        ) {
            return null;
        }


        /*
         * Tanto "system" quanto "window"
         * usam agora o mesmo pipeline:
         *
         * helper nativo
         *   ↓
         * PCM
         *   ↓
         * AudioWorklet
         *   ↓
         * MediaStreamTrack
         */

        return await prepareNativeAudioTrack();
    }


    /*
     * =========================
     * SINCRONIZAR ÁUDIO LIVEKIT
     * =========================
     */

    async function syncPublishedAudioTrack(
        room: Room,
        desiredAudioTrack:
            MediaStreamTrack | null
    ) {
        const publication =
            room
                .localParticipant
                .getTrackPublication(
                    Track.Source
                        .ScreenShareAudio
                );


        const liveKitAudioTrack =
            publication
                ?.audioTrack;


        if (
            !desiredAudioTrack
        ) {
            if (
                publication
                    ?.track
            ) {
                await room
                    .localParticipant
                    .unpublishTrack(
                        publication.track
                    );
            }


            publishedAudioTrackRef.current =
                null;


            return;
        }


        if (
            liveKitAudioTrack
        ) {
            if (
                publishedAudioTrackRef.current !==
                desiredAudioTrack
            ) {
                await liveKitAudioTrack
                    .replaceTrack(
                        desiredAudioTrack
                    );
            }


            publishedAudioTrackRef.current =
                desiredAudioTrack;


            return;
        }


        await room
            .localParticipant
            .publishTrack(
                desiredAudioTrack,
                {
                    name:
                        "screen-audio",

                    source:
                        Track.Source
                            .ScreenShareAudio,
                }
            );


        publishedAudioTrackRef.current =
            desiredAudioTrack;
    }


    /*
     * =========================
     * ENCERRAR HOST COM RETRY
     * =========================
     */

    async function endHostSessionWithRetry() {
        let lastError:
            unknown =
            null;


        for (
            let attempt =
                0;
            attempt <
            2;
            attempt++
        ) {
            try {
                return await window
                    .electronAPI
                    .endHostSession();

            } catch (error) {
                lastError =
                    error;


                if (
                    attempt ===
                    0
                ) {
                    await new Promise<void>(
                        (
                            resolve
                        ) => {

                            window.setTimeout(
                                resolve,
                                300
                            );
                        }
                    );
                }
            }
        }


        throw (
            lastError ||
            new Error(
                "Não foi possível finalizar a Session."
            )
        );
    }


    /*
     * =========================
     * LIVEKIT
     * =========================
     */

    async function handleConnectLiveKit():
        Promise<boolean> {

        let hostSessionStarted =
            false;


        let createdRoom:
            Room | null =
            null;


        try {
            setError(
                ""
            );


            transmissionActiveRef.current =
                false;


            const currentChannelId =
                await ensureChannel();


            if (
                !currentChannelId
            ) {
                return false;
            }


            if (
                roomRef.current
            ) {
                const oldRoom =
                    roomRef.current;


                roomRef.current =
                    null;


                await oldRoom
                    .disconnect()
                    .catch(
                        () => {
                            // Cleanup.
                        }
                    );
            }


            publishedAudioTrackRef.current =
                null;


            setViewerCount(
                0
            );


            /*
             * O nome pessoal não precisa
             * circular no metadata do LiveKit.
             */

            const rawSession =
                await window
                    .electronAPI
                    .startHostSession(
                        "Host",
                        maxViewers
                    );


            hostSessionStarted =
                true;


            const data =
                sanitizeHostSession(
                    rawSession,
                    currentChannelId
                );


            const room =
                new Room();


            createdRoom =
                room;


            room.on(
                RoomEvent
                    .ParticipantConnected,
                () => {

                    updateViewerCount(
                        room
                    );
                }
            );


            room.on(
                RoomEvent
                    .ParticipantDisconnected,
                () => {

                    updateViewerCount(
                        room
                    );
                }
            );


            room.on(
                RoomEvent
                    .Disconnected,
                () => {

                    publishedAudioTrackRef.current =
                        null;


                    setViewerCount(
                        0
                    );


                    if (
                        roomRef.current ===
                        room
                    ) {
                        roomRef.current =
                            null;
                    }


                    /*
                     * Se a desconexão não foi
                     * causada por "Parar",
                     * o convite não deve continuar
                     * aparecendo como válido.
                     */

                    if (
                        transmissionActiveRef.current
                    ) {
                        transmissionActiveRef.current =
                            false;


                        setShareLink(
                            ""
                        );


                        setError(
                            "A conexão com a transmissão foi encerrada."
                        );


                        setView(
                            "preview"
                        );


                        void window
                            .electronAPI
                            .endHostSession()
                            .catch(
                                () => {
                                    // Backend possui detecção
                                    // adicional de host ausente.
                                }
                            );
                    }
                }
            );


            roomRef.current =
                room;


            await room.connect(
                data.serverUrl,
                data.token
            );


            updateViewerCount(
                room
            );


            setChannelId(
                data.channelId
            );


            setShareLink(
                buildShareLink(
                    data
                )
            );


            setMaxViewers(
                data.maxViewers
            );


            setLinkCopied(
                false
            );


            return true;

        } catch (err) {
            transmissionActiveRef.current =
                false;


            setShareLink(
                ""
            );


            setViewerCount(
                0
            );


            if (
                createdRoom
            ) {
                if (
                    roomRef.current ===
                    createdRoom
                ) {
                    roomRef.current =
                        null;
                }


                await createdRoom
                    .disconnect()
                    .catch(
                        () => {
                            // Cleanup.
                        }
                    );
            }


            if (
                hostSessionStarted
            ) {
                await endHostSessionWithRetry()
                    .catch(
                        () => {
                            // O erro original é
                            // mais importante aqui.
                        }
                    );
            }


            setError(
                getSafeErrorMessage(
                    err,
                    "Não foi possível conectar ao serviço de transmissão."
                )
            );


            return false;
        }
    }


    /*
     * =========================
     * FONTES
     * =========================
     */

    async function loadDesktopSources():
        Promise<boolean> {

        try {
            const rawSources =
                await window
                    .electronAPI
                    .getDesktopSources();


            const safeSources =
                sanitizeDesktopSources(
                    rawSources
                );


            setSources(
                safeSources
            );


            return true;

        } catch {
            setError(
                "Não foi possível localizar as telas e janelas."
            );


            return false;
        }
    }


    /*
     * =========================
     * HOME
     * =========================
     */

    async function handleOpenShare() {
        try {
            setLoading(
                true
            );


            setError(
                ""
            );


            const currentChannelId =
                await ensureChannel();


            if (
                !currentChannelId
            ) {
                return;
            }


            await loadWindowAudioSupport();


            const sourcesLoaded =
                await loadDesktopSources();


            if (
                !sourcesLoaded
            ) {
                return;
            }


            setSelectedSource(
                null
            );


            setView(
                "select"
            );

        } catch (err) {
            setError(
                getSafeErrorMessage(
                    err,
                    "Não foi possível preparar o compartilhamento."
                )
            );

        } finally {
            setLoading(
                false
            );
        }
    }


    /*
     * =========================
     * VÍDEO
     * =========================
     */

    function getVideoConstraints(
        settings: StreamSettings
    ): MediaTrackConstraints {

        const width =
            settings.quality ===
                "1080p"
                ? 1920
                : 1280;


        const height =
            settings.quality ===
                "1080p"
                ? 1080
                : 720;


        return {
            width: {
                ideal:
                    width,
            },

            height: {
                ideal:
                    height,
            },

            frameRate: {
                ideal:
                    settings.fps,

                max:
                    settings.fps,
            },
        };
    }


    function getSettingsLabel() {
        let audioLabel =
            "Áudio desativado";


        if (
            streamSettings
                .audioEnabled
        ) {
            if (
                selectedSource
                    ?.type ===
                "screen"
            ) {
                audioLabel =
                    "Áudio do sistema";

            } else if (
                selectedSource
                    ?.type ===
                "window"
            ) {
                audioLabel =
                    "Áudio da janela";

            } else {
                audioLabel =
                    "Áudio ativado";
            }
        }


        return (
            `${streamSettings.quality} • ` +
            `${streamSettings.fps} FPS • ` +
            audioLabel
        );
    }


    /*
     * =========================
     * CONFIGURAÇÕES
     * =========================
     */

    function handleOpenSettings() {
        setDraftSettings({
            ...streamSettings,
        });


        setDraftMaxViewers(
            maxViewers
        );


        setSettingsOpen(
            true
        );
    }


    function handleCloseSettings() {
        if (
            isApplyingSettings
        ) {
            return;
        }


        setSettingsOpen(
            false
        );
    }


    /*
     * =========================
     * CAPTURA ENCERRADA PELO SO
     * =========================
     */

    function handleDisplayTrackEnded() {
        if (
            transmissionActiveRef.current
        ) {
            void handleStopTransmission();


            return;
        }


        void (
            async () => {

                await handleStopCapture();


                setView(
                    "select"
                );
            }
        )();
    }


    /*
     * =========================
     * PRÉVIA
     * =========================
     */

    async function handleContinue() {
        if (
            !selectedSource
        ) {
            return;
        }


        let mediaStream:
            MediaStream | null =
            null;


        try {
            setLoading(
                true
            );


            setError(
                ""
            );


            if (
                selectedSource.type ===
                "window" &&
                streamSettings.audioEnabled &&
                windowAudioSupport &&
                !windowAudioSupport
                    .supported
            ) {
                setError(
                    windowAudioSupport.reason ||
                    "O áudio exclusivo desta janela não é suportado neste Windows. O vídeo será compartilhado sem áudio."
                );
            }


            const audioMode =
                getAudioMode(
                    selectedSource,
                    streamSettings
                );


            if (
                audioMode !==
                "off"
            ) {
                await prepareNativeAudioTrack();
            }


            await window
                .electronAPI
                .setSelectedSource(
                    selectedSource.id,
                    audioMode
                );


            if (
                streamRef.current
            ) {
                streamRef.current
                    .getTracks()
                    .forEach(
                        (
                            track
                        ) => {

                            track.onended =
                                null;


                            track.stop();
                        }
                    );


                streamRef.current =
                    null;
            }


            mediaStream =
                await navigator
                    .mediaDevices
                    .getDisplayMedia({
                        video:
                            getVideoConstraints(
                                streamSettings
                            ),

                        audio:
                            false,
                    });


            const videoTrack =
                mediaStream
                    .getVideoTracks()[0];


            if (
                !videoTrack
            ) {
                throw new Error(
                    "A fonte selecionada não possui vídeo."
                );
            }


            videoTrack.onended =
                handleDisplayTrackEnded;


            streamRef.current =
                mediaStream;


            setIsCapturing(
                true
            );


            setView(
                "preview"
            );

        } catch (err) {
            if (
                mediaStream
            ) {
                mediaStream
                    .getTracks()
                    .forEach(
                        (
                            track
                        ) => {

                            track.onended =
                                null;


                            track.stop();
                        }
                    );
            }


            await window
                .electronAPI
                .stopWindowAudio()
                .catch(
                    () => {
                        // Cleanup.
                    }
                );


            await destroyNativeAudioTrack();


            setIsCapturing(
                false
            );


            const message =
                err instanceof DOMException &&
                    err.name ===
                    "NotAllowedError"
                    ? "O compartilhamento de tela foi cancelado."
                    : getSafeErrorMessage(
                        err,
                        "Não foi possível iniciar a captura."
                    );


            setError(
                message
            );

        } finally {
            setLoading(
                false
            );
        }
    }


    /*
     * =========================
     * INICIAR LIVE
     * =========================
     */

    async function handleStartTransmission() {
        if (
            !streamRef.current ||
            !selectedSource
        ) {
            setError(
                "A captura não está pronta para iniciar."
            );


            return;
        }


        try {
            setError(
                ""
            );


            setIsPublishing(
                true
            );


            const connected =
                await handleConnectLiveKit();


            if (
                !connected
            ) {
                return;
            }


            const room =
                roomRef.current;


            const stream =
                streamRef.current;


            if (
                !room ||
                !stream
            ) {
                throw new Error(
                    "A transmissão não está disponível."
                );
            }


            const videoTrack =
                stream
                    .getVideoTracks()[0];


            if (
                !videoTrack
            ) {
                throw new Error(
                    "Nenhuma track de vídeo está disponível."
                );
            }


            await room
                .localParticipant
                .publishTrack(
                    videoTrack,
                    {
                        name:
                            "screen-video",

                        source:
                            Track.Source
                                .ScreenShare,

                        simulcast:
                            true,
                    }
                );


            const desiredAudioTrack =
                await resolveAudioTrack(
                    selectedSource,
                    streamSettings
                );


            await syncPublishedAudioTrack(
                room,
                desiredAudioTrack
            );


            transmissionActiveRef.current =
                true;


            setLinkCopied(
                false
            );


            setView(
                "live"
            );

        } catch (err) {
            transmissionActiveRef.current =
                false;


            const room =
                roomRef.current;


            roomRef.current =
                null;


            if (room) {
                await room
                    .disconnect()
                    .catch(
                        () => {
                            // Cleanup.
                        }
                    );
            }


            await endHostSessionWithRetry()
                .catch(
                    () => {
                        // Backend também possui
                        // proteção de host ausente.
                    }
                );


            setShareLink(
                ""
            );


            publishedAudioTrackRef.current =
                null;


            setViewerCount(
                0
            );


            setError(
                getSafeErrorMessage(
                    err,
                    "Não foi possível iniciar a transmissão."
                )
            );

        } finally {
            setIsPublishing(
                false
            );
        }
    }


    /*
     * =========================
     * COPIAR LINK
     * =========================
     */

    async function handleCopyLink() {
        if (
            !shareLink
        ) {
            return;
        }


        try {
            await navigator
                .clipboard
                .writeText(
                    shareLink
                );


            setLinkCopied(
                true
            );


            if (
                copyTimeoutRef.current !==
                null
            ) {
                window.clearTimeout(
                    copyTimeoutRef.current
                );
            }


            copyTimeoutRef.current =
                window.setTimeout(
                    () => {

                        setLinkCopied(
                            false
                        );


                        copyTimeoutRef.current =
                            null;
                    },
                    2000
                );

        } catch {
            setError(
                "Não foi possível copiar o link."
            );
        }
    }


    /*
     * =========================
     * ABRIR TROCA
     * =========================
     */

    async function handleOpenSourceSwitch() {
        try {
            setLoading(
                true
            );


            setError(
                ""
            );


            const loaded =
                await loadDesktopSources();


            if (
                !loaded
            ) {
                return;
            }


            setPendingSource(
                null
            );


            setView(
                "change-source"
            );

        } finally {
            setLoading(
                false
            );
        }
    }


    /*
     * =========================
     * APLICAR SETTINGS
     * =========================
     */

    async function handleApplySettings() {
        if (
            view !==
            "live"
        ) {
            setStreamSettings({
                ...draftSettings,
            });


            setMaxViewers(
                draftMaxViewers
            );


            setSettingsOpen(
                false
            );


            return;
        }


        const room =
            roomRef.current;


        const oldStream =
            streamRef.current;


        const currentSource =
            selectedSource;


        if (
            !room ||
            !oldStream ||
            !currentSource
        ) {
            setError(
                "A transmissão atual não está disponível."
            );


            return;
        }


        const oldSettings:
            StreamSettings = {
            ...streamSettings,
        };


        const oldAudioMode =
            getAudioMode(
                currentSource,
                oldSettings
            );


        const oldVideoTrack =
            oldStream
                .getVideoTracks()[0];


        let oldAudioTrack:
            MediaStreamTrack | null =
            null;


        if (
            oldAudioMode !==
            "off"
        ) {
            oldAudioTrack =
                nativeAudioTrackRef
                    .current;
        }


        let newStream:
            MediaStream | null =
            null;


        let videoWasReplaced =
            false;


        try {
            setError(
                ""
            );


            setIsApplyingSettings(
                true
            );


            const newAudioMode =
                getAudioMode(
                    currentSource,
                    draftSettings
                );


            if (
                newAudioMode !==
                "off"
            ) {
                await prepareNativeAudioTrack();
            }


            await window
                .electronAPI
                .setSelectedSource(
                    currentSource.id,
                    newAudioMode
                );


            newStream =
                await navigator
                    .mediaDevices
                    .getDisplayMedia({
                        video:
                            getVideoConstraints(
                                draftSettings
                            ),

                        audio:
                            false,
                    });


            const newVideoTrack =
                newStream
                    .getVideoTracks()[0];


            if (
                !newVideoTrack
            ) {
                throw new Error(
                    "Não foi possível obter a nova track de vídeo."
                );
            }


            const videoPublication =
                room
                    .localParticipant
                    .getTrackPublication(
                        Track.Source
                            .ScreenShare
                    );


            const publishedVideoTrack =
                videoPublication
                    ?.videoTrack;


            if (
                !publishedVideoTrack
            ) {
                throw new Error(
                    "A track de vídeo publicada não foi encontrada."
                );
            }


            await publishedVideoTrack
                .replaceTrack(
                    newVideoTrack
                );


            videoWasReplaced =
                true;


            const desiredAudioTrack =
                await resolveAudioTrack(
                    currentSource,
                    draftSettings
                );


            await syncPublishedAudioTrack(
                room,
                desiredAudioTrack
            );


            streamRef.current =
                newStream;


            if (
                videoRef.current
            ) {
                videoRef.current
                    .srcObject =
                    newStream;


                await videoRef.current
                    .play()
                    .catch(
                        () => {
                            // Preview muted.
                        }
                    );
            }


            oldStream
                .getTracks()
                .forEach(
                    (
                        track
                    ) => {

                        track.onended =
                            null;


                        track.stop();
                    }
                );


            if (
                newAudioMode ===
                "off"
            ) {
                await destroyNativeAudioTrack();
            }


            newVideoTrack.onended =
                handleDisplayTrackEnded;


            setStreamSettings({
                ...draftSettings,
            });


            setSettingsOpen(
                false
            );

        } catch (err) {
            let rollbackSucceeded =
                false;


            try {
                await window
                    .electronAPI
                    .setSelectedSource(
                        currentSource.id,
                        oldAudioMode
                    );


                if (
                    videoWasReplaced
                ) {
                    if (
                        !oldVideoTrack ||
                        oldVideoTrack
                            .readyState !==
                        "live"
                    ) {
                        throw new Error(
                            "A track de vídeo anterior não está mais disponível."
                        );
                    }


                    const rollbackPublication =
                        room
                            .localParticipant
                            .getTrackPublication(
                                Track.Source
                                    .ScreenShare
                            );


                    const rollbackVideoTrack =
                        rollbackPublication
                            ?.videoTrack;


                    if (
                        !rollbackVideoTrack
                    ) {
                        throw new Error(
                            "A publicação de vídeo anterior não foi encontrada."
                        );
                    }


                    await rollbackVideoTrack
                        .replaceTrack(
                            oldVideoTrack
                        );
                }


                if (
                    oldAudioMode ===
                    "off"
                ) {
                    await syncPublishedAudioTrack(
                        room,
                        null
                    );

                } else {
                    if (
                        !oldAudioTrack ||
                        oldAudioTrack
                            .readyState !==
                        "live"
                    ) {
                        throw new Error(
                            "A track de áudio anterior não está mais disponível."
                        );
                    }


                    await syncPublishedAudioTrack(
                        room,
                        oldAudioTrack
                    );
                }


                if (
                    oldAudioMode ===
                    "off"
                ) {
                    await destroyNativeAudioTrack();
                }


                if (
                    newStream
                ) {
                    newStream
                        .getTracks()
                        .forEach(
                            (
                                track
                            ) => {

                                track.onended =
                                    null;


                                track.stop();
                            }
                        );
                }


                streamRef.current =
                    oldStream;


                if (
                    videoRef.current
                ) {
                    videoRef.current
                        .srcObject =
                        oldStream;


                    await videoRef.current
                        .play()
                        .catch(
                            () => {
                                // Preview muted.
                            }
                        );
                }


                setStreamSettings({
                    ...oldSettings,
                });


                setDraftSettings({
                    ...oldSettings,
                });


                setIsCapturing(
                    true
                );


                rollbackSucceeded =
                    true;

            } catch {
                rollbackSucceeded =
                    false;
            }


            if (
                rollbackSucceeded
            ) {
                setError(
                    `Não foi possível aplicar as novas configurações. As configurações anteriores foram mantidas. ${getSafeErrorMessage(
                        err,
                        ""
                    )}`.trim()
                );

            } else {
                setError(
                    "Não foi possível aplicar as novas configurações e a restauração automática também falhou. Encerre a transmissão e inicie novamente."
                );
            }

        } finally {
            setIsApplyingSettings(
                false
            );
        }
    }


    /*
     * =========================
     * TROCAR FONTE AO VIVO
     * =========================
     */

    async function handleApplySourceSwitch() {
        if (
            !pendingSource ||
            !selectedSource
        ) {
            return;
        }


        const room =
            roomRef.current;


        const oldStream =
            streamRef.current;


        if (
            !room ||
            !oldStream
        ) {
            setError(
                "A transmissão atual não está disponível."
            );


            return;
        }


        const oldSource =
            selectedSource;


        const oldAudioMode =
            getAudioMode(
                oldSource,
                streamSettings
            );


        const oldVideoTrack =
            oldStream
                .getVideoTracks()[0];


        let oldAudioTrack:
            MediaStreamTrack | null =
            null;


        if (
            oldAudioMode !==
            "off"
        ) {
            oldAudioTrack =
                nativeAudioTrackRef
                    .current;
        }


        let newStream:
            MediaStream | null =
            null;


        let videoWasReplaced =
            false;


        try {
            setError(
                ""
            );


            setIsSwitchingSource(
                true
            );


            const newSource =
                pendingSource;


            const newAudioMode =
                getAudioMode(
                    newSource,
                    streamSettings
                );


            if (
                newAudioMode !==
                "off"
            ) {
                await prepareNativeAudioTrack();
            }


            await window
                .electronAPI
                .setSelectedSource(
                    newSource.id,
                    newAudioMode
                );


            newStream =
                await navigator
                    .mediaDevices
                    .getDisplayMedia({
                        video:
                            getVideoConstraints(
                                streamSettings
                            ),

                        audio:
                            false,
                    });


            const newVideoTrack =
                newStream
                    .getVideoTracks()[0];


            if (
                !newVideoTrack
            ) {
                throw new Error(
                    "A nova fonte não possui vídeo."
                );
            }


            const videoPublication =
                room
                    .localParticipant
                    .getTrackPublication(
                        Track.Source
                            .ScreenShare
                    );


            const publishedVideoTrack =
                videoPublication
                    ?.videoTrack;


            if (
                !publishedVideoTrack
            ) {
                throw new Error(
                    "A track de vídeo atual não foi encontrada."
                );
            }


            await publishedVideoTrack
                .replaceTrack(
                    newVideoTrack
                );


            videoWasReplaced =
                true;


            const desiredAudioTrack =
                await resolveAudioTrack(
                    newSource,
                    streamSettings
                );


            await syncPublishedAudioTrack(
                room,
                desiredAudioTrack
            );


            streamRef.current =
                newStream;


            if (
                videoRef.current
            ) {
                videoRef.current
                    .srcObject =
                    newStream;


                await videoRef.current
                    .play()
                    .catch(
                        () => {
                            // Preview muted.
                        }
                    );
            }


            oldStream
                .getTracks()
                .forEach(
                    (
                        track
                    ) => {

                        track.onended =
                            null;


                        track.stop();
                    }
                );


            if (
                newAudioMode ===
                "off"
            ) {
                await destroyNativeAudioTrack();
            }


            newVideoTrack.onended =
                handleDisplayTrackEnded;


            setSelectedSource(
                newSource
            );


            setPendingSource(
                null
            );


            setIsCapturing(
                true
            );


            setView(
                "live"
            );

        } catch (err) {
            let rollbackSucceeded =
                false;


            try {
                await window
                    .electronAPI
                    .setSelectedSource(
                        oldSource.id,
                        oldAudioMode
                    );


                if (
                    videoWasReplaced
                ) {
                    if (
                        !oldVideoTrack ||
                        oldVideoTrack
                            .readyState !==
                        "live"
                    ) {
                        throw new Error(
                            "A track de vídeo anterior não está mais disponível."
                        );
                    }


                    const rollbackPublication =
                        room
                            .localParticipant
                            .getTrackPublication(
                                Track.Source
                                    .ScreenShare
                            );


                    const rollbackVideoTrack =
                        rollbackPublication
                            ?.videoTrack;


                    if (
                        !rollbackVideoTrack
                    ) {
                        throw new Error(
                            "A publicação anterior não foi encontrada."
                        );
                    }


                    await rollbackVideoTrack
                        .replaceTrack(
                            oldVideoTrack
                        );
                }


                if (
                    oldAudioMode ===
                    "off"
                ) {
                    await syncPublishedAudioTrack(
                        room,
                        null
                    );

                } else {
                    if (
                        !oldAudioTrack ||
                        oldAudioTrack
                            .readyState !==
                        "live"
                    ) {
                        throw new Error(
                            "A track de áudio anterior não está mais disponível."
                        );
                    }


                    await syncPublishedAudioTrack(
                        room,
                        oldAudioTrack
                    );
                }


                if (
                    oldAudioMode ===
                    "off"
                ) {
                    await destroyNativeAudioTrack();
                }


                if (
                    newStream
                ) {
                    newStream
                        .getTracks()
                        .forEach(
                            (
                                track
                            ) => {

                                track.onended =
                                    null;


                                track.stop();
                            }
                        );
                }


                streamRef.current =
                    oldStream;


                if (
                    videoRef.current
                ) {
                    videoRef.current
                        .srcObject =
                        oldStream;


                    await videoRef.current
                        .play()
                        .catch(
                            () => {
                                // Preview muted.
                            }
                        );
                }


                setSelectedSource(
                    oldSource
                );


                setPendingSource(
                    null
                );


                setIsCapturing(
                    true
                );


                setView(
                    "live"
                );


                rollbackSucceeded =
                    true;

            } catch {
                rollbackSucceeded =
                    false;
            }


            if (
                rollbackSucceeded
            ) {
                setError(
                    `Não foi possível alterar a tela. A transmissão anterior foi mantida. ${getSafeErrorMessage(
                        err,
                        ""
                    )}`.trim()
                );

            } else {
                setError(
                    "Não foi possível alterar a tela e a restauração automática também falhou. Encerre a transmissão e inicie novamente."
                );
            }

        } finally {
            setIsSwitchingSource(
                false
            );
        }
    }


    /*
     * =========================
     * PARAR TRANSMISSÃO
     * =========================
     */

    async function handleStopTransmission() {
        if (
            stoppingTransmissionRef.current
        ) {
            return;
        }


        stoppingTransmissionRef.current =
            true;


        transmissionActiveRef.current =
            false;


        setIsStoppingTransmission(
            true
        );


        setShareLink(
            ""
        );


        setLinkCopied(
            false
        );


        const room =
            roomRef.current;


        const stream =
            streamRef.current;


        let serverEndFailed =
            false;


        /*
         * Um erro em unpublish não pode
         * impedir o encerramento no backend.
         */

        if (
            room &&
            stream
        ) {
            try {
                await room
                    .localParticipant
                    .unpublishTracks(
                        stream
                            .getTracks()
                    );


                const remainingAudioPublication =
                    room
                        .localParticipant
                        .getTrackPublication(
                            Track.Source
                                .ScreenShareAudio
                        );


                if (
                    remainingAudioPublication
                        ?.track
                ) {
                    await room
                        .localParticipant
                        .unpublishTrack(
                            remainingAudioPublication
                                .track
                        );
                }

            } catch {
                /*
                 * Continuamos para /end
                 * e disconnect mesmo assim.
                 */
            }
        }


        try {
            await endHostSessionWithRetry();

        } catch {
            serverEndFailed =
                true;
        }


        if (room) {
            await room
                .disconnect()
                .catch(
                    () => {
                        // Cleanup.
                    }
                );
        }


        if (
            roomRef.current ===
            room
        ) {
            roomRef.current =
                null;
        }


        publishedAudioTrackRef.current =
            null;


        await handleStopCapture();


        setViewerCount(
            0
        );


        setSelectedSource(
            null
        );


        setPendingSource(
            null
        );


        await loadDesktopSources();


        setView(
            "select"
        );


        if (
            serverEndFailed
        ) {
            setError(
                "A transmissão foi interrompida localmente, mas não foi possível confirmar imediatamente o encerramento no servidor."
            );
        }


        setIsStoppingTransmission(
            false
        );


        stoppingTransmissionRef.current =
            false;
    }


    /*
     * =========================
     * CANCELAR TROCA
     * =========================
     */

    function handleCancelSourceSwitch() {
        setPendingSource(
            null
        );


        setView(
            "live"
        );
    }


    /*
     * =========================
     * VOLTAR DA PRÉVIA
     * =========================
     */

    async function handleBackToSelection() {
        await handleStopCapture();


        setView(
            "select"
        );
    }


    /*
     * =========================
     * PARAR CAPTURA
     * =========================
     */

    async function handleStopCapture() {
        await window
            .electronAPI
            .stopWindowAudio()
            .catch(
                () => {
                    // Cleanup.
                }
            );


        const stream =
            streamRef.current;


        streamRef.current =
            null;


        if (stream) {
            stream
                .getTracks()
                .forEach(
                    (
                        track
                    ) => {

                        track.onended =
                            null;


                        try {
                            track.stop();
                        } catch {
                            // Já encerrada.
                        }
                    }
                );
        }


        if (
            videoRef.current
        ) {
            videoRef.current
                .srcObject =
                null;
        }


        await destroyNativeAudioTrack();


        publishedAudioTrackRef.current =
            null;


        setIsCapturing(
            false
        );
    }


    /*
     * =========================
     * HOME
     * =========================
     */

    async function handleBackHome() {
        await handleStopCapture();


        setSelectedSource(
            null
        );


        setSources(
            []
        );


        setError(
            ""
        );


        setView(
            "home"
        );
    }


    /*
     * =========================
     * INTERFACE
     * =========================
     */

    return (
        <main className="app">


            {/* HOME */}
            {view ===
                "home" && (

                    <section className="home-screen">

                        <div className="home-ambient home-ambient-one" />
                        <div className="home-ambient home-ambient-two" />


                        <div className="home-content">

                            <div className="home-brand">

                                <div className="home-logo">

                                    <svg
                                        className="home-logo-icon"
                                        viewBox="0 0 64 64"
                                        aria-hidden="true"
                                    >
                                        <circle
                                            cx="32"
                                            cy="32"
                                            r="4"
                                        />

                                        <path d="M23 23C18 28 18 36 23 41" />
                                        <path d="M41 23C46 28 46 36 41 41" />

                                        <path d="M16 16C7.5 24.5 7.5 39.5 16 48" />
                                        <path d="M48 16C56.5 24.5 56.5 39.5 48 48" />
                                    </svg>


                                    <span>
                                        ShareRoom
                                    </span>

                                </div>

                            </div>


                            <div className="home-copy">

                                <h1>
                                    Pronto para compartilhar
                                </h1>


                                <p>
                                    Transmita sua tela ou uma janela de forma rápida
                                    <br />
                                    e simples, e compartilhe com outras pessoas.
                                </p>

                            </div>


                            <button
                                className="home-share-button"
                                onClick={
                                    handleOpenShare
                                }
                                disabled={
                                    loading
                                }
                            >

                                <svg
                                    className="home-button-icon"
                                    viewBox="0 0 24 24"
                                    aria-hidden="true"
                                >
                                    <rect
                                        x="3"
                                        y="4"
                                        width="18"
                                        height="13"
                                        rx="2"
                                    />

                                    <path d="M9 21h6" />
                                    <path d="M12 17v4" />
                                </svg>


                                <span>
                                    {loading
                                        ? "Preparando..."
                                        : "Compartilhar tela"}
                                </span>

                            </button>


                            <div className="home-security">

                                <svg
                                    viewBox="0 0 24 24"
                                    aria-hidden="true"
                                >
                                    <rect
                                        x="5"
                                        y="10"
                                        width="14"
                                        height="10"
                                        rx="2"
                                    />

                                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                                </svg>


                                <span>
                                    Transmissão simples, segura e em tempo real.
                                </span>

                            </div>

                        </div>

                    </section>
                )}


            {/* SELEÇÃO */}
            {view ===
                "select" && (

                    <section className="select-screen source-picker">

                        <header className="select-topbar">

                            <button
                                className="back-button"
                                onClick={
                                    handleBackHome
                                }
                                title="Voltar ao início"
                            >
                                ←
                            </button>


                            <div className="select-title">

                                <h1>
                                    Escolha o que compartilhar
                                </h1>

                                <p>
                                    Selecione uma tela ou janela
                                </p>

                            </div>


                            <div className="select-actions">

                                <button
                                    className="settings-button"
                                    title="Configurações da transmissão"
                                    onClick={
                                        handleOpenSettings
                                    }
                                >
                                    <span aria-hidden="true">⚙</span> Configurações
                                </button>


                                <button
                                    className="share-selected-button"
                                    onClick={
                                        handleContinue
                                    }
                                    disabled={
                                        !selectedSource ||
                                        loading
                                    }
                                >
                                    <svg className="picker-control-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 8h18M12 18v-7m-3 3 3-3 3 3"/></svg>
                                    {loading
                                        ? "Preparando..."
                                        : "Compartilhar"}
                                </button>

                            </div>

                        </header>


                        <div className="source-toolbar">
                            <div className="source-filters" role="group" aria-label="Filtrar fontes">
                                {(["all", "screen", "window"] as const).map((filter) => (
                                    <button key={filter} className="source-filter"
                                        aria-pressed={sourceFilter === filter}
                                        onClick={() => setSourceFilter(filter)}>
                                        {filter !== "all" && <svg className="picker-control-icon" viewBox="0 0 24 24" aria-hidden="true">
                                            <rect x="2" y="3" width="20" height="15" rx="2" />
                                            {filter === "screen" ? <path d="M12 18v3M7 21h10" /> : <path d="M2 8h20" />}
                                        </svg>}
                                        {filter === "all" ? "Todas" : filter === "screen" ? "Telas" : "Janelas"}
                                        <span> ({sources.filter((source) => filter === "all" || source.type === filter).length})</span>
                                    </button>
                                ))}
                            </div>
                            <label className="source-search">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>
                                <input type="search" aria-label="Buscar janela ou aplicativo"
                                    placeholder="Buscar janela ou aplicativo..."
                                    value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} />
                            </label>
                        </div>

                        <div className="source-grid selection-grid">

                            {sources.filter((source) =>
                                (sourceFilter === "all" || source.type === sourceFilter) &&
                                source.name.toLocaleLowerCase().includes(sourceSearch.trim().toLocaleLowerCase())
                            ).map(
                                (
                                    source
                                ) => {

                                    const isSelected =
                                        selectedSource
                                            ?.id ===
                                        source.id;


                                    return (
                                        <button
                                            key={source.id}
                                            aria-pressed={isSelected}
                                            title={source.name}
                                            onClick={
                                                () =>
                                                    setSelectedSource(
                                                        source
                                                    )
                                            }
                                            className={
                                                isSelected
                                                    ? "source-card selected"
                                                    : "source-card"
                                            }
                                        >

                                            <div className="thumbnail-wrapper">

                                                <img
                                                    className="source-thumbnail"
                                                    src={
                                                        source.thumbnail
                                                    }
                                                    alt={
                                                        source.name
                                                    }
                                                />


                                                {isSelected && (
                                                    <span className="source-check">
                                                        ✓
                                                    </span>
                                                )}

                                            </div>


                                            <div className="source-info">

                                                {source.appIcon ? (
                                                    <img
                                                        className="source-icon"
                                                        src={
                                                            source.appIcon
                                                        }
                                                        alt=""
                                                    />
                                                ) : (
                                                    <svg className="source-fallback-icon" viewBox="0 0 24 24" aria-hidden="true">
                                                        <rect x="2" y="3" width="20" height="15" rx="2" />
                                                        {source.type === "screen" ? <path d="M12 18v4M7 22h10" /> : <path d="M2 8h20" />}
                                                    </svg>
                                                )}


                                                <div className="source-description">
                                                    <strong>{source.name}</strong>
                                                    <small>{source.type === "screen" ? "Tela inteira" : "Janela de aplicativo"}</small>
                                                </div>

                                            </div>

                                        </button>
                                    );
                                }
                            )}
                            {!sources.some((source) =>
                                (sourceFilter === "all" || source.type === sourceFilter) &&
                                source.name.toLocaleLowerCase().includes(sourceSearch.trim().toLocaleLowerCase())
                            ) && <p className="source-empty" role="status">Nenhuma fonte encontrada. Tente outro filtro ou busca.</p>}

                        </div>

                    </section>
                )}


            {/* PRÉVIA */}
            {view ===
                "preview" && (

                    <section className="preview-screen">

                        <div className="preview-header">

                            <div>

                                <span className="preview-label">
                                    PRÉVIA
                                </span>


                                <h1>
                                    {selectedSource
                                        ?.name}
                                </h1>
                                <p className="preview-subtitle">Confira como sua tela ou janela será transmitida para os espectadores.</p>

                            </div>

                        </div>


                        <div className="preview-video-container">

                            <video
                                ref={
                                    videoRef
                                }
                                className="preview-video"
                                autoPlay
                                playsInline
                                muted
                            />

                        </div>


                        <div className="preview-details">

                            <div className="preview-source-info">
                                <svg className="preview-source-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M7 21h10"/></svg>

                                <strong>
                                    {selectedSource
                                        ?.name}
                                </strong>


                                <p>
                                    {getSettingsLabel()}
                                </p>

                            </div>


                            <div className="preview-actions">

                                <button
                                    className="secondary-button"
                                    onClick={
                                        handleBackToSelection
                                    }
                                >
                                    ← Voltar
                                </button>


                                <button
                                    className="primary-button"
                                    onClick={
                                        handleStartTransmission
                                    }
                                    disabled={
                                        isPublishing
                                    }
                                >
                                    <svg className="preview-transmit-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 3a12 12 0 0 0 0 18M20 3a12 12 0 0 1 0 18"/></svg>
                                    {isPublishing
                                        ? "Iniciando..."
                                        : "Iniciar transmissão"}
                                </button>

                            </div>

                        </div>

                    </section>
                )}


            {/* ALTERAR TELA */}
            {view ===
                "change-source" && (

                    <section className="select-screen source-picker switch-picker">

                        <header className="select-topbar">

                            <button
                                className="back-button"
                                onClick={
                                    handleCancelSourceSwitch
                                }
                            >
                                ←
                            </button>


                            <div className="select-title">
                                <span className="live-badge"><span className="live-dot" /> AO VIVO</span>

                                <h1>
                                    Alterar tela
                                </h1>


                                <p>
                                    A transmissão continuará ativa enquanto você escolhe outra fonte
                                </p>

                            </div>


                            <div className="switch-status">
                                <div><svg className="switch-ui-icon switch-channel-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 3a12 12 0 0 0 0 18M20 3a12 12 0 0 1 0 18"/></svg><div className="switch-status-copy"><strong>Canal ativo</strong><span>{channelId}</span></div></div>
                                <div><svg className="switch-ui-icon " viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M2 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3M17 4a3 3 0 0 1 0 6M19 13a5 5 0 0 1 3 5v3"/></svg><div className="switch-status-copy"><strong>Espectadores</strong><span>{viewerCount} / {maxViewers}</span></div></div>
                                <div><span className="switch-transmission-dot" aria-hidden="true" /><div className="switch-status-copy"><strong>Transmissão em andamento</strong><span>{getSettingsLabel()}</span></div></div>
                            </div>

                        </header>


                        <div className="source-grid selection-grid">

                            {sources.map(
                                (
                                    source
                                ) => {

                                    const isSelected =
                                        pendingSource
                                            ?.id ===
                                        source.id;


                                    const isCurrent =
                                        selectedSource
                                            ?.id ===
                                        source.id;


                                    return (
                                        <button
                                            key={
                                                source.id
                                            }
                                            onClick={
                                                () =>
                                                    setPendingSource(
                                                        source
                                                    )
                                            }
                                            className={`source-card${isSelected ? " selected" : ""}${isCurrent ? " current" : ""}`}
                                            aria-pressed={isSelected}
                                            title={source.name}
                                        >

                                            <div className="thumbnail-wrapper">

                                                <img
                                                    className="source-thumbnail"
                                                    src={
                                                        source.thumbnail
                                                    }
                                                    alt={
                                                        source.name
                                                    }
                                                />


                                                {isSelected && (
                                                    <span className="source-check">
                                                        ✓
                                                    </span>
                                                )}


                                                {isCurrent &&
                                                    !isSelected && (

                                                        <span className="current-source-badge">
                                                            ATUAL
                                                        </span>
                                                    )}

                                            </div>


                                            <div className="source-info">

                                                {source.appIcon ? (
                                                    <img
                                                        className="source-icon"
                                                        src={
                                                            source.appIcon
                                                        }
                                                        alt=""
                                                    />
                                                ) : <svg className="source-fallback-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="15" rx="2"/><path d="M12 18v4M7 22h10"/></svg>}


                                                <div className="source-description">
                                                    <strong>{source.name}</strong>
                                                    <small>{isCurrent ? "Fonte atual" : isSelected ? "Nova seleção" : source.type === "screen" ? "Tela inteira" : "Janela de aplicativo"}</small>
                                                </div>

                                            </div>

                                        </button>
                                    );
                                }
                            )}

                        </div>

                    <footer className="switch-footer">
                            <div className="switch-help"><svg className="switch-ui-icon " viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7v.1"/></svg><p>Você pode trocar a fonte sem interromper quem está assistindo.</p><span className="switch-help-divider" aria-hidden="true"/><p>A troca acontece sem encerrar a transmissão.</p></div>
                            <div className="select-actions">

                                <button
                                    className="secondary-button"
                                    onClick={
                                        handleCancelSourceSwitch
                                    }
                                >
                                    Cancelar
                                </button>


                                <button
                                    className="share-selected-button"
                                    onClick={
                                        handleApplySourceSwitch
                                    }
                                    disabled={
                                        !pendingSource ||
                                        isSwitchingSource
                                    }
                                >
                                    <svg className="switch-ui-icon " viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M7 21h10"/></svg>
                                    {isSwitchingSource
                                        ? "Alterando..."
                                        : "Aplicar nova tela"}
                                </button>

                            </div>
                        </footer>
                    </section>
                )}


            {/* AO VIVO */}
            {view ===
                "live" && (

                    <section className="live-screen">

                        <header className="live-header">

                            <div className="live-heading">

                                <span className="live-badge">

                                    <span className="live-dot" />

                                    AO VIVO

                                </span>


                                <h1>
                                    {selectedSource
                                        ?.name}
                                </h1>
                                <p className="live-source-caption">{selectedSource?.type === "screen" ? "Compartilhando uma tela" : "Compartilhando uma janela"}</p>

                            </div>


                            <div className="live-header-actions">

                                <button
                                    className="secondary-button"
                                    onClick={
                                        handleOpenSourceSwitch
                                    }
                                    disabled={
                                        isStoppingTransmission
                                    }
                                >
                                    <svg className="live-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M7 21h10"/></svg> Alterar tela
                                </button>


                                <button
                                    className="secondary-button"
                                    onClick={
                                        handleOpenSettings
                                    }
                                    disabled={
                                        isStoppingTransmission
                                    }
                                >
                                    <svg className="live-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3 1-2h4l1 2 2 1 2-.2 2 3-1 2v3l1 2-2 3-2-.2-2 1-1 2h-4l-1-2-2-1-2 .2-2-3 1-2v-3l-1-2 2-3 2 .2Z" transform="translate(0 2) scale(1 .9)"/><circle cx="12" cy="12" r="3.5"/></svg> Configurações
                                </button>


                                <button
                                    className="stop-transmission-button"
                                    onClick={
                                        handleStopTransmission
                                    }
                                    disabled={
                                        isStoppingTransmission
                                    }
                                >
                                    <svg className="live-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" stroke="none"/></svg>
                                    {isStoppingTransmission
                                        ? "Encerrando..."
                                        : "Parar transmissão"}
                                </button>

                            </div>

                        </header>


                        <div className="live-video-container">

                            <video
                                ref={
                                    videoRef
                                }
                                className="live-video"
                                autoPlay
                                playsInline
                                muted
                            />

                        </div>


                        <footer className="live-footer">

                            <div className="live-info">

                                <span>
                                    <span className="live-dot" aria-hidden="true" /> Transmitindo
                                </span>


                                <span>
                                    <svg className="live-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M2 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3M17 4a3 3 0 0 1 0 6M19 13a5 5 0 0 1 3 5v3"/></svg> Espectadores:{" "}
                                    {viewerCount}
                                    {" / "}
                                    {maxViewers}
                                </span>


                                {channelId && (
                                    <span>
                                        <svg className="live-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/></svg> Canal: {channelId}
                                    </span>
                                )}

                            </div>


                            <div className="preview-actions">

                                <button
                                    className="secondary-button"
                                    onClick={
                                        handleCopyLink
                                    }
                                    disabled={
                                        !shareLink ||
                                        isStoppingTransmission
                                    }
                                >
                                    <svg className="live-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M13 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0)"/></svg>
                                    {linkCopied
                                        ? "Link copiado ✓"
                                        : "Copiar link"}
                                </button>


                                <div className="live-quality">
                                    {getSettingsLabel()}
                                </div>

                            </div>

                        </footer>

                    </section>
                )}


            {/* CONFIGURAÇÕES */}
            {settingsOpen && (

                <div className="settings-overlay">

                    <div className="settings-modal">

                        <div className="settings-modal-header">

                            <span className="settings-heading-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24"><path d="m9 3 1-2h4l1 2 2 1 2-.2 2 3-1 2v3l1 2-2 3-2-.2-2 1-1 2h-4l-1-2-2-1-2 .2-2-3 1-2v-3l-1-2 2-3 2 .2Z" transform="translate(0 2) scale(1 .9)"/><circle cx="12" cy="12" r="3.5"/></svg>
                            </span>
                            <div className="settings-heading-copy">

                                <h2>
                                    Configurações
                                </h2>

                                <p>
                                    Ajuste a qualidade da transmissão
                                </p>

                            </div>


                            <button
                                className="settings-close-button"
                                onClick={
                                    handleCloseSettings
                                }
                                disabled={
                                    isApplyingSettings
                                }
                            >
                                ×
                            </button>

                        </div>


                        <div className="settings-group">

                            <span className="settings-group-title">
                                Qualidade
                            </span>


                            <div className="settings-options">

                                <button
                                    className={
                                        draftSettings.quality ===
                                            "720p"
                                            ? "settings-option active"
                                            : "settings-option"
                                    }
                                    onClick={
                                        () =>
                                            setDraftSettings(
                                                (
                                                    current
                                                ) => ({
                                                    ...current,

                                                    quality:
                                                        "720p",
                                                })
                                            )
                                    }
                                >
                                    <strong>
                                        720p
                                    </strong>

                                    <small>
                                        Menor uso de banda
                                    </small>
                                </button>


                                <button
                                    className={
                                        draftSettings.quality ===
                                            "1080p"
                                            ? "settings-option active"
                                            : "settings-option"
                                    }
                                    onClick={
                                        () =>
                                            setDraftSettings(
                                                (
                                                    current
                                                ) => ({
                                                    ...current,

                                                    quality:
                                                        "1080p",
                                                })
                                            )
                                    }
                                >
                                    <strong>
                                        1080p
                                    </strong>

                                    <small>
                                        Melhor qualidade
                                    </small>
                                </button>

                            </div>

                        </div>


                        <div className="settings-group">

                            <span className="settings-group-title">
                                Taxa de quadros
                            </span>


                            <div className="settings-options">

                                <button
                                    className={
                                        draftSettings.fps ===
                                            30
                                            ? "settings-option active"
                                            : "settings-option"
                                    }
                                    onClick={
                                        () =>
                                            setDraftSettings(
                                                (
                                                    current
                                                ) => ({
                                                    ...current,

                                                    fps:
                                                        30,
                                                })
                                            )
                                    }
                                >
                                    <strong>
                                        30 FPS
                                    </strong>

                                    <small>
                                        Mais econômico
                                    </small>
                                </button>


                                <button
                                    className={
                                        draftSettings.fps ===
                                            60
                                            ? "settings-option active"
                                            : "settings-option"
                                    }
                                    onClick={
                                        () =>
                                            setDraftSettings(
                                                (
                                                    current
                                                ) => ({
                                                    ...current,

                                                    fps:
                                                        60,
                                                })
                                            )
                                    }
                                >
                                    <strong>
                                        60 FPS
                                    </strong>

                                    <small>
                                        Mais fluido
                                    </small>
                                </button>

                            </div>

                        </div>


                        {view !==
                            "live" && (

                                <div className="settings-group">

                                    <span className="settings-group-title">
                                        Limite de espectadores
                                    </span>


                                    <div className="settings-options settings-viewer-options">

                                        {MAX_VIEWERS_OPTIONS.map(
                                            (
                                                limit
                                            ) => (

                                                <button
                                                    key={
                                                        limit
                                                    }
                                                    className={
                                                        draftMaxViewers ===
                                                            limit
                                                            ? "settings-option active"
                                                            : "settings-option"
                                                    }
                                                    onClick={
                                                        () =>
                                                            setDraftMaxViewers(
                                                                limit
                                                            )
                                                    }
                                                >
                                                    <strong>
                                                        {limit}
                                                    </strong>

                                                    <small>
                                                        {limit ===
                                                            1
                                                            ? "espectador"
                                                            : "espectadores"}
                                                    </small>
                                                </button>

                                            )
                                        )}

                                    </div>

                                </div>
                            )}


                        <div className="settings-audio-row">

                            <span className="settings-audio-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24"><path d="M11 4 5 9H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16"/></svg>
                            </span>
                            <div className="settings-audio-copy">

                                <strong>
                                    Compartilhar áudio
                                </strong>

                                <p>
                                    Transmitir o áudio junto com a tela
                                </p>

                            </div>


                            <button
                                className={
                                    draftSettings.audioEnabled
                                        ? "audio-switch active"
                                        : "audio-switch"
                                }
                                onClick={
                                    () =>
                                        setDraftSettings(
                                            (
                                                current
                                            ) => ({
                                                ...current,

                                                audioEnabled:
                                                    !current
                                                        .audioEnabled,
                                            })
                                        )
                                }
                            >
                                <span />
                            </button>

                        </div>


                        <div className="settings-modal-actions">

                            <button
                                className="secondary-button"
                                onClick={
                                    handleCloseSettings
                                }
                                disabled={
                                    isApplyingSettings
                                }
                            >
                                Cancelar
                            </button>


                            <button
                                className="primary-button"
                                onClick={
                                    handleApplySettings
                                }
                                disabled={
                                    isApplyingSettings
                                }
                            >
                                {isApplyingSettings
                                    ? "Aplicando..."
                                    : "Aplicar"}
                            </button>

                        </div>

                    </div>

                </div>
            )}


            {/* ERRO GLOBAL */}
            {error && (

                <div className="global-error">
                    {error}
                </div>
            )}

        </main>
    );
}