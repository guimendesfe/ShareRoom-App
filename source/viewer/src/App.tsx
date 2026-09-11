import {
    Room,
    RoomEvent,
    Track,
    type RemoteTrack,
} from "livekit-client";

import {
    useEffect,
    useRef,
    useState,
    type ChangeEvent,
} from "react";

import "./App.css";


type ViewerStatus =
    | "connecting"
    | "connected"
    | "watching"
    | "ended"
    | "error";


type ViewerInvite = {
    channelId: string;
    sessionId: string;
    viewerAccess: string;
};


const API_URL =
    import.meta.env.VITE_API_URL ||
    "http://localhost:3001";


const CHANNEL_ID_PATTERN =
    /^[A-Za-z0-9_-]{12}$/;


const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


const ACCESS_PATTERN =
    /^[A-Za-z0-9_-]{32,128}$/;


export default function App() {
    /*
     * =========================
     * ESTADOS
     * =========================
     */

    const [
        status,
        setStatus,
    ] =
        useState<ViewerStatus>(
            "connecting"
        );


    const [
        hasVideo,
        setHasVideo,
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
        volume,
        setVolume,
    ] =
        useState(
            1
        );


    const [
        muted,
        setMuted,
    ] =
        useState(
            false
        );


    /*
     * O navegador bloqueou
     * autoplay com som.
     */

    const [
        audioBlocked,
        setAudioBlocked,
    ] =
        useState(
            false
        );


    /*
     * =========================
     * REFS
     * =========================
     */

    const roomRef =
        useRef<Room | null>(
            null
        );


    const videoRef =
        useRef<HTMLVideoElement | null>(
            null
        );


    const audioRef =
        useRef<HTMLAudioElement | null>(
            null
        );


    const playerRef =
        useRef<HTMLDivElement | null>(
            null
        );


    const channelIdRef =
        useRef(
            ""
        );


    const sessionIdRef =
        useRef(
            ""
        );


    const viewerAccessRef =
        useRef(
            ""
        );


    /*
     * Mantemos o valor atual
     * para callbacks do LiveKit.
     */

    const volumeRef =
        useRef(
            1
        );


    const mutedRef =
        useRef(
            false
        );


    /*
     * Evita várias verificações
     * simultâneas de status.
     */

    const checkingStatusRef =
        useRef(
            false
        );


    /*
     * Impede callbacks antigos
     * de alterar a tela depois
     * que o componente desmontou.
     */

    const mountedRef =
        useRef(
            true
        );


    /*
     * =========================
     * STORAGE KEY
     * =========================
     */

    function getViewerAccessStorageKey(
        channelId: string,
        sessionId: string
    ) {
        return (
            `shareroom-viewer:` +
            `${channelId}:` +
            `${sessionId}`
        );
    }


    /*
     * =========================
     * CONVITE PELA URL
     * =========================
     */

    function getInviteFromUrl():
        ViewerInvite | null {

        const parts =
            window.location.pathname
                .split("/")
                .filter(
                    Boolean
                );


        /*
         * Esperado:
         *
         * /s/CHANNEL
         */

        if (
            parts.length !==
            2 ||
            parts[0] !==
            "s"
        ) {
            return null;
        }


        const channelId =
            parts[1]
                ?.trim() ||
            "";


        const searchParams =
            new URLSearchParams(
                window.location.search
            );


        const sessionId =
            searchParams
                .get(
                    "session"
                )
                ?.trim() ||
            "";


        /*
         * Chave enviada originalmente:
         *
         * #access=...
         */

        const hashParams =
            new URLSearchParams(
                window.location.hash
                    .replace(
                        /^#/,
                        ""
                    )
            );


        const accessFromHash =
            hashParams
                .get(
                    "access"
                )
                ?.trim() ||
            "";


        /*
         * Fazemos validação básica
         * antes de usar qualquer valor.
         */

        if (
            !CHANNEL_ID_PATTERN.test(
                channelId
            ) ||
            !UUID_PATTERN.test(
                sessionId
            )
        ) {
            return null;
        }


        const storageKey =
            getViewerAccessStorageKey(
                channelId,
                sessionId
            );


        /*
         * Se veio uma chave nova no
         * fragmento, utilizamos ela.
         *
         * Se a página foi atualizada,
         * recuperamos da sessionStorage.
         */

        let viewerAccess =
            accessFromHash;


        if (
            !viewerAccess
        ) {
            try {
                viewerAccess =
                    window
                        .sessionStorage
                        .getItem(
                            storageKey
                        ) ||
                    "";

            } catch {
                viewerAccess =
                    "";
            }
        }


        if (
            !ACCESS_PATTERN.test(
                viewerAccess
            )
        ) {
            return null;
        }


        /*
         * Guarda a chave apenas nesta
         * aba para permitir F5.
         */

        try {
            window
                .sessionStorage
                .setItem(
                    storageKey,
                    viewerAccess
                );
        } catch {
            /*
             * sessionStorage pode estar
             * indisponível em modos muito
             * restritivos do navegador.
             */
        }


        /*
         * =========================
         * LIMPAR A CHAVE DA URL
         * =========================
         */

        if (
            window.location.hash
        ) {
            const safeUrl =
                window.location.pathname +
                window.location.search;


            window.history.replaceState(
                null,
                "",
                safeUrl
            );
        }


        return {
            channelId,
            sessionId,
            viewerAccess,
        };
    }


    /*
     * =========================
     * TENTAR TOCAR ÁUDIO
     * =========================
     */

    async function tryPlayAudio():
        Promise<boolean> {

        const audio =
            audioRef.current;


        if (!audio) {
            return false;
        }


        audio.volume =
            volumeRef.current;


        audio.muted =
            mutedRef.current;


        try {
            await audio.play();


            if (
                mountedRef.current
            ) {
                setAudioBlocked(
                    false
                );
            }


            return true;

        } catch {
            if (
                mountedRef.current
            ) {
                setAudioBlocked(
                    true
                );
            }


            return false;
        }
    }


    /*
     * =========================
     * ÁUDIO COMEÇOU
     * =========================
     */

    function handleAudioPlaying() {
        setAudioBlocked(
            false
        );
    }


    /*
     * =========================
     * TRANSMISSÃO ENCERRADA
     * =========================
     */

    function setTransmissionEnded() {
        if (
            !mountedRef.current
        ) {
            return;
        }


        setHasVideo(
            false
        );


        setAudioBlocked(
            false
        );


        setStatus(
            "ended"
        );
    }


    /*
     * =========================
     * STATUS DA SESSION
     * =========================
     */

    async function checkChannelStatus() {
        const channelId =
            channelIdRef.current;


        const sessionId =
            sessionIdRef.current;


        const viewerAccess =
            viewerAccessRef.current;


        if (
            !channelId ||
            !sessionId ||
            !viewerAccess ||
            checkingStatusRef.current
        ) {
            return;
        }


        try {
            checkingStatusRef.current =
                true;


            const response =
                await fetch(
                    `${API_URL}/channels/${encodeURIComponent(
                        channelId
                    )}/status`,
                    {
                        method:
                            "POST",

                        headers: {
                            "Content-Type":
                                "application/json",
                        },

                        body:
                            JSON.stringify({
                                sessionId,
                                viewerAccess,
                            }),

                        cache:
                            "no-store",

                        credentials:
                            "omit",

                        referrerPolicy:
                            "no-referrer",
                    }
                );


            const data =
                await response
                    .json()
                    .catch(
                        () => ({})
                    );


            if (
                !mountedRef.current
            ) {
                return;
            }


            if (
                response.status ===
                403
            ) {
                setHasVideo(
                    false
                );


                setAudioBlocked(
                    false
                );


                setError(
                    "Este link de transmissão é inválido ou expirou."
                );


                setStatus(
                    "error"
                );


                return;
            }


            if (
                response.status ===
                400
            ) {
                setHasVideo(
                    false
                );


                setError(
                    "Este link de transmissão é inválido."
                );


                setStatus(
                    "error"
                );


                return;
            }


            if (
                response.status ===
                404
            ) {
                setHasVideo(
                    false
                );


                setError(
                    "Este link de transmissão não existe."
                );


                setStatus(
                    "error"
                );


                return;
            }


            if (
                !response.ok
            ) {
                return;
            }


            if (
                !data.live ||
                data.ended
            ) {
                setTransmissionEnded();


                return;
            }


            setStatus(
                "connected"
            );

        } catch (err) {
            console.error(
                "Erro verificando transmissão:",
                err
            );

        } finally {
            checkingStatusRef.current =
                false;
        }
    }


    /*
     * =========================
     * RECEBER TRACK
     * =========================
     */

    function attachTrack(
        track: RemoteTrack
    ) {
        if (
            track.kind ===
            Track.Kind.Video &&
            videoRef.current
        ) {
            track.attach(
                videoRef.current
            );


            setHasVideo(
                true
            );


            setStatus(
                "watching"
            );
        }


        if (
            track.kind ===
            Track.Kind.Audio &&
            audioRef.current
        ) {
            track.attach(
                audioRef.current
            );


            audioRef.current.volume =
                volumeRef.current;


            audioRef.current.muted =
                mutedRef.current;


            void tryPlayAudio();
        }
    }


    /*
     * =========================
     * CONECTAR À SESSION
     * =========================
     */

    async function connectToChannel(
        channelId: string,
        sessionId: string,
        viewerAccess: string
    ) {
        try {
            setError(
                ""
            );


            setAudioBlocked(
                false
            );


            setStatus(
                "connecting"
            );


            if (
                roomRef.current
            ) {
                await roomRef.current
                    .disconnect();


                roomRef.current =
                    null;
            }


            const response =
                await fetch(
                    `${API_URL}/channels/${encodeURIComponent(
                        channelId
                    )}/viewer-token`,
                    {
                        method:
                            "POST",

                        headers: {
                            "Content-Type":
                                "application/json",
                        },

                        body:
                            JSON.stringify({
                                sessionId,
                                viewerAccess,

                                participantName:
                                    `Viewer-${Date.now()}`,
                            }),

                        cache:
                            "no-store",

                        credentials:
                            "omit",

                        referrerPolicy:
                            "no-referrer",
                    }
                );


            const data =
                await response
                    .json()
                    .catch(
                        () => ({})
                    );


            if (
                !mountedRef.current
            ) {
                return;
            }


            if (
                response.status ===
                410
            ) {
                setTransmissionEnded();


                return;
            }


            if (
                response.status ===
                403
            ) {
                setError(
                    "Este link de transmissão é inválido ou expirou."
                );


                setStatus(
                    "error"
                );


                return;
            }


            if (
                response.status ===
                400
            ) {
                setError(
                    "Este link de transmissão é inválido."
                );


                setStatus(
                    "error"
                );


                return;
            }


            if (
                response.status ===
                429
            ) {
                setError(
                    data.message ||
                    "Esta transmissão atingiu o limite de espectadores."
                );


                setStatus(
                    "error"
                );


                return;
            }


            if (
                response.status ===
                404
            ) {
                setError(
                    "Este link de transmissão não existe."
                );


                setStatus(
                    "error"
                );


                return;
            }


            if (
                !response.ok
            ) {
                throw new Error(
                    "Não foi possível entrar na transmissão."
                );
            }


            const room =
                new Room({
                    adaptiveStream:
                        true,

                    dynacast:
                        true,
                });


            room.on(
                RoomEvent
                    .TrackSubscribed,
                (
                    track:
                        RemoteTrack
                ) => {

                    if (
                        !mountedRef.current
                    ) {
                        return;
                    }


                    attachTrack(
                        track
                    );
                }
            );


            room.on(
                RoomEvent
                    .TrackUnsubscribed,
                (track) => {

                    track.detach();


                    if (
                        !mountedRef.current
                    ) {
                        return;
                    }


                    if (
                        track.kind ===
                        Track.Kind.Video
                    ) {
                        setHasVideo(
                            false
                        );


                        window.setTimeout(
                            () => {
                                void checkChannelStatus();
                            },
                            300
                        );
                    }


                    if (
                        track.kind ===
                        Track.Kind.Audio
                    ) {
                        setAudioBlocked(
                            false
                        );
                    }
                }
            );


            room.on(
                RoomEvent
                    .ParticipantDisconnected,
                () => {

                    if (
                        !mountedRef.current
                    ) {
                        return;
                    }


                    window.setTimeout(
                        () => {
                            void checkChannelStatus();
                        },
                        300
                    );
                }
            );


            room.on(
                RoomEvent
                    .Disconnected,
                () => {

                    if (
                        !mountedRef.current
                    ) {
                        return;
                    }


                    setHasVideo(
                        false
                    );


                    setAudioBlocked(
                        false
                    );


                    void checkChannelStatus();
                }
            );


            roomRef.current =
                room;


            setStatus(
                "connected"
            );


            await room.connect(
                data.serverUrl,
                data.token,
                {
                    autoSubscribe:
                        true,
                }
            );

        } catch (err) {
            console.error(
                "Erro conectando Viewer:",
                err
            );


            if (
                !mountedRef.current
            ) {
                return;
            }


            setStatus(
                "error"
            );


            setError(
                "Não foi possível entrar na transmissão."
            );
        }
    }


    /*
     * =========================
     * ENTRADA AUTOMÁTICA
     * =========================
     */

    useEffect(
        () => {

            mountedRef.current =
                true;


            const invite =
                getInviteFromUrl();


            /*
             * =========================
             * LINK INVÁLIDO
             * =========================
             *
             * O estado é atualizado no
             * próximo ciclo para evitar
             * setState síncrono dentro
             * do effect.
             */

            if (!invite) {
                const invalidInviteTimer =
                    window.setTimeout(
                        () => {

                            if (
                                !mountedRef.current
                            ) {
                                return;
                            }


                            setError(
                                "Link de transmissão inválido ou incompleto."
                            );


                            setStatus(
                                "error"
                            );
                        },
                        0
                    );


                return () => {
                    mountedRef.current =
                        false;


                    window.clearTimeout(
                        invalidInviteTimer
                    );
                };
            }


            channelIdRef.current =
                invite.channelId;


            sessionIdRef.current =
                invite.sessionId;


            viewerAccessRef.current =
                invite.viewerAccess;


            /*
             * =========================
             * CONEXÃO
             * =========================
             *
             * A conexão também começa
             * no próximo ciclo.
             *
             * connectToChannel altera
             * estados internamente.
             *
             * Dessa forma ela não é
             * chamada sincronamente
             * pelo useEffect.
             */

            const connectTimer =
                window.setTimeout(
                    () => {

                        if (
                            !mountedRef.current
                        ) {
                            return;
                        }


                        void connectToChannel(
                            invite.channelId,
                            invite.sessionId,
                            invite.viewerAccess
                        );
                    },
                    0
                );


            return () => {
                mountedRef.current =
                    false;


                window.clearTimeout(
                    connectTimer
                );


                const room =
                    roomRef.current;


                roomRef.current =
                    null;


                if (
                    room
                ) {
                    void room.disconnect();
                }
            };

        },
        []
    );


    /*
     * =========================
     * VOLUME
     * =========================
     */

    function handleVolumeChange(
        event:
            ChangeEvent<HTMLInputElement>
    ) {
        const newVolume =
            Number(
                event.target.value
            );


        volumeRef.current =
            newVolume;


        setVolume(
            newVolume
        );


        const audio =
            audioRef.current;


        if (audio) {
            audio.volume =
                newVolume;
        }


        if (
            newVolume >
            0
        ) {
            mutedRef.current =
                false;


            setMuted(
                false
            );


            if (audio) {
                audio.muted =
                    false;


                if (
                    audio.paused ||
                    audioBlocked
                ) {
                    audio
                        .play()
                        .then(
                            () => {
                                setAudioBlocked(
                                    false
                                );
                            }
                        )
                        .catch(
                            () => {
                                setAudioBlocked(
                                    true
                                );
                            }
                        );
                }
            }
        }
    }


    /*
     * =========================
     * MUTE
     * =========================
     */

    function handleToggleMute() {
        const newMuted =
            !muted;


        mutedRef.current =
            newMuted;


        setMuted(
            newMuted
        );


        const audio =
            audioRef.current;


        if (!audio) {
            return;
        }


        audio.muted =
            newMuted;


        if (
            !newMuted
        ) {
            void audio
                .play()
                .then(
                    () => {
                        setAudioBlocked(
                            false
                        );
                    }
                )
                .catch(
                    () => {
                        setAudioBlocked(
                            true
                        );
                    }
                );
        }
    }


    /*
     * =========================
     * FULLSCREEN
     * =========================
     */

    async function handleFullscreen() {
        const player =
            playerRef.current;


        if (!player) {
            return;
        }


        try {
            if (
                document
                    .fullscreenElement
            ) {
                await document
                    .exitFullscreen();


                return;
            }


            await player
                .requestFullscreen();

        } catch (err) {
            console.error(
                "Erro no fullscreen:",
                err
            );
        }
    }


    /*
     * =========================
     * INTERFACE
     * =========================
     */

    return (
        <main className="viewer">


            {/* =========================
                CONECTANDO
            ========================== */}

            {status ===
                "connecting" && (

                    <section className="status-screen connecting-screen"><div className="watch-brand"><svg className="waiting-symbol" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/><path d="M23 23C18 28 18 36 23 41M41 23C46 28 46 36 41 41M16 16C7.5 24.5 7.5 39.5 16 48M48 16C56.5 24.5 56.5 39.5 48 48"/></svg><span><em>Share</em>Room</span></div><div className="connecting-panel"><div className="waiting-content" role="status">
    <div className="waiting-emblem"><svg className="waiting-symbol" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/><path d="M23 23C18 28 18 36 23 41M41 23C46 28 46 36 41 41M16 16C7.5 24.5 7.5 39.5 16 48M48 16C56.5 24.5 56.5 39.5 48 48"/></svg></div>
    <h2>Entrando na transmissão...</h2>
    <p>Estamos conectando você à transmissão.<br/>Assim que estiver disponível, o vídeo aparecerá aqui.</p>
    <div className="waiting-status-bar">
        <div><span className="waiting-state-dot" aria-hidden="true"/><span><strong>Conectando ao canal</strong><small>Estabelecendo a conexão</small></span></div>
        <div><svg className="waiting-clock" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg><span><strong>Aguardando vídeo</strong><small>A exibição começará automaticamente</small></span></div>
    </div>
</div></div></section>
                )}


            {/* =========================
                PLAYER
            ========================== */}

            {(status ===
                "connected" ||
                status ===
                "watching") && (

                    <section className="watch-screen">
                        <div className="watch-brand"><svg className="watch-icon watch-brand-symbol" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/><path d="M23 23C18 28 18 36 23 41M41 23C46 28 46 36 41 41M16 16C7.5 24.5 7.5 39.5 16 48M48 16C56.5 24.5 56.5 39.5 48 48"/></svg><span><em>Share</em>Room</span></div>


                        <header className="watch-header">

                            <div>

                                <span className="live-label">

                                    <span
                                        className={
                                            hasVideo
                                                ? "live-dot"
                                                : "waiting-dot-small"
                                        }
                                    />


                                    {hasVideo
                                        ? "AO VIVO"
                                        : "CONECTADO"}

                                </span>


                                <strong>
                                    {hasVideo ? "Transmissão ao vivo" : "Aguardando transmissão"}
                                </strong>
                                <p className="watch-subtitle">{hasVideo ? "Você está assistindo a uma tela compartilhada" : "A conexão está ativa. Aguardando o vídeo."}</p>

                            </div>

                        </header>


                        <div
                            ref={
                                playerRef
                            }
                            className="player-shell"
                        >


                            <div className="video-container">


                                {!hasVideo && (

                                    <div className="waiting-overlay"><div className="waiting-content" role="status">
    <div className="waiting-emblem"><svg className="waiting-symbol" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/><path d="M23 23C18 28 18 36 23 41M41 23C46 28 46 36 41 41M16 16C7.5 24.5 7.5 39.5 16 48M48 16C56.5 24.5 56.5 39.5 48 48"/></svg></div>
    <h2>Aguardando transmissão</h2>
    <p>A conexão está ativa. Aguarde o vídeo da transmissão.<br/>Assim que estiver disponível, o vídeo aparecerá aqui.</p>
    <div className="waiting-status-bar">
        <div><span className="waiting-state-dot connected" aria-hidden="true"/><span><strong>Canal conectado</strong><small>Sua conexão está ativa</small></span></div>
        <div><svg className="waiting-clock" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg><span><strong>Aguardando vídeo</strong><small>A exibição começará automaticamente</small></span></div>
    </div>
</div></div>
                                )}


                                <video
                                    ref={
                                        videoRef
                                    }
                                    className="stream-video"
                                    autoPlay
                                    playsInline
                                    muted
                                />


                                <audio
                                    ref={
                                        audioRef
                                    }
                                    autoPlay
                                    onPlaying={
                                        handleAudioPlaying
                                    }
                                />

                            </div>


                            {hasVideo && (

                                <div className="player-controls">


                                    <div className="volume-controls">


                                        


                                        <button
                                            className="control-button"
                                            onClick={
                                                handleToggleMute
                                            }
                                            title={
                                                muted
                                                    ? "Ativar áudio"
                                                    : "Silenciar"
                                            }
                                        >

                                            <svg className="watch-icon" viewBox="0 0 24 24" aria-hidden="true">
                                                <path d="M11 4 5 9H2v6h3l6 5Z" />
                                                {muted || volume === 0 ? <path d="m16 9 6 6m0-6-6 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 4a11 11 0 0 1 0 16" /></>}
                                            </svg>

                                        </button>


                                        <input
                                            className="volume-slider"
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.01"
                                            value={
                                                volume
                                            }
                                            onChange={
                                                handleVolumeChange
                                            }
                                            aria-label="Volume"
                                        />


                                        <span className="volume-value">

                                            {Math.round(
                                                volume *
                                                100
                                            )}

                                            %

                                        </span>

                                    </div>


                                    <button
                                        className="control-button fullscreen-button"
                                        onClick={
                                            handleFullscreen
                                        }
                                        title="Tela cheia"
                                    >
                                        ⛶
                                    </button>

                                </div>
                            )}

                        </div>

                    <footer className="watch-summary">
                            <div className="watch-summary-item"><svg className="watch-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3M12 15v3"/></svg><div><strong>Conectado por convite</strong><small>Assistindo à transmissão compartilhada com você</small></div></div>
                            <div className="watch-summary-item"><svg className="watch-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4 5 9H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16"/></svg><div><strong>{audioBlocked ? "Áudio aguardando ativação" : muted || volume === 0 ? "Volume silenciado" : "Volume habilitado"}</strong><small>Sem som? Mova o controle de volume na barra do vídeo para ativar o áudio.</small></div></div>
                        </footer>
                    </section>
                )}


            {/* =========================
                TRANSMISSÃO ENCERRADA
            ========================== */}

            {status ===
                "ended" && (

                    <section className="status-screen ended-screen">
                        <div className="watch-brand"><svg className="watch-icon watch-brand-symbol" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/><path d="M23 23C18 28 18 36 23 41M41 23C46 28 46 36 41 41M16 16C7.5 24.5 7.5 39.5 16 48M48 16C56.5 24.5 56.5 39.5 48 48"/></svg><span><em>Share</em>Room</span></div>
                        <div className="ended-panel" role="status">
                            <div className="ended-emblem" aria-hidden="true">
                                <svg viewBox="0 0 64 64"><path d="M45 14H12a4 4 0 0 0-4 4v25M56 19v25a4 4 0 0 1-4 4H25M27 48v10M37 48v10M20 58h24M8 56 57 7" /></svg>
                            </div>
                            <h2>Transmissão encerrada</h2>
                            <p className="ended-description">O anfitrião finalizou o compartilhamento.</p>
                            <p className="ended-guidance">Para assistir novamente, solicite um novo link ao anfitrião.</p>
                            <div className="ended-invite-note">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7v.1"/></svg>
                                <span>Este convite não pode ser reutilizado em uma nova transmissão.</span>
                            </div>
                            <small className="ended-close-hint">Você já pode fechar esta aba.</small>
                        </div>
                    </section>
                )}


            {/* =========================
                ERRO
            ========================== */}

            {status ===
                "error" && (

                    <section className="status-screen ended-screen unavailable-screen">
                        <div className="watch-brand"><svg className="watch-icon watch-brand-symbol" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/><path d="M23 23C18 28 18 36 23 41M41 23C46 28 46 36 41 41M16 16C7.5 24.5 7.5 39.5 16 48M48 16C56.5 24.5 56.5 39.5 48 48"/></svg><span><em>Share</em>Room</span></div>
                        <div className="ended-panel unavailable-panel" role="alert">
                            <div className="ended-emblem" aria-hidden="true">
                                <svg viewBox="0 0 64 64">
                                    {error === "Esta transmissão atingiu o limite de espectadores." ? <><circle cx="32" cy="21" r="8"/><circle cx="12" cy="25" r="6"/><circle cx="52" cy="25" r="6"/><path d="M17 51v-4a15 15 0 0 1 30 0v4ZM12 36a10 10 0 0 0-10 10v5h9M52 36a10 10 0 0 1 10 10v5h-9"/></> : <><circle cx="32" cy="32" r="24"/><path d="M32 17v18M32 45v1"/></>}
                                </svg>
                            </div>
                            <h2>{error === "Esta transmissão atingiu o limite de espectadores." ? "Limite de espectadores atingido" : "Transmissão indisponível"}</h2>
                            <p className="ended-description">{error}</p>
                            {error === "Esta transmissão atingiu o limite de espectadores." && <>
                                <p className="ended-guidance">Todas as vagas estão ocupadas no momento.</p>
                                <div className="ended-invite-note">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                                    <span>Tente novamente em instantes, atualizando esta página.</span>
                                </div>
                            </>}
                        </div>
                    </section>
                )}

        </main>
    );
}