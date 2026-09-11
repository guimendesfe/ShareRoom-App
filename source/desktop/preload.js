const {
    contextBridge,
    ipcRenderer,
} = require(
    "electron"
);


/*
 * =========================
 * LIMITES
 * =========================
 */

const MIN_VIEWERS =
    1;


const MAX_VIEWERS =
    12;


const MAX_PARTICIPANT_NAME_LENGTH =
    80;


const MAX_SOURCE_ID_LENGTH =
    512;


/*
 * Proteção contra payload PCM
 * anormalmente grande.
 */

const MAX_PCM_CHUNK_BYTES =
    1024 * 1024;


/*
 * =========================
 * PARTICIPANT NAME
 * =========================
 */

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


/*
 * =========================
 * MAX VIEWERS
 * =========================
 */

function validateMaxViewers(
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
        throw new TypeError(
            `O limite de espectadores deve estar entre ${MIN_VIEWERS} e ${MAX_VIEWERS}.`
        );
    }


    return parsed;
}


/*
 * =========================
 * SOURCE ID
 * =========================
 */

function validateSourceId(
    value
) {
    if (
        typeof value !==
        "string" ||
        value.length ===
        0 ||
        value.length >
        MAX_SOURCE_ID_LENGTH ||
        (
            !value.startsWith(
                "screen:"
            ) &&
            !value.startsWith(
                "window:"
            )
        )
    ) {
        throw new TypeError(
            "Fonte de captura inválida."
        );
    }


    return value;
}


/*
 * =========================
 * AUDIO MODE
 * =========================
 */

function validateAudioMode(
    value
) {
    if (
        value !==
        "off" &&
        value !==
        "system" &&
        value !==
        "window"
    ) {
        throw new TypeError(
            "Modo de áudio inválido."
        );
    }


    return value;
}


/*
 * =========================
 * CALLBACK
 * =========================
 */

function validateCallback(
    callback
) {
    if (
        typeof callback !==
        "function"
    ) {
        throw new TypeError(
            "Callback inválido."
        );
    }


    return callback;
}


/*
 * =========================
 * API EXPOSTA AO RENDERER
 * =========================
 *
 * Não existe IPC genérico.
 *
 * Cada capacidade possui
 * uma função específica.
 */

const electronAPI =
    Object.freeze({


        /*
         * =========================
         * WINDOW AUDIO SUPPORT
         * =========================
         */

        getWindowAudioSupport:
            () => {

                return ipcRenderer
                    .invoke(
                        "window-audio:getSupport"
                    );
            },


        /*
         * =========================
         * HOST CHANNEL
         * =========================
         */

        ensureHostChannel:
            () => {

                return ipcRenderer
                    .invoke(
                        "host:ensureChannel"
                    );
            },


        /*
         * =========================
         * HOST SESSION
         * =========================
         */

        startHostSession:
            (
                participantName,
                maxViewers
            ) => {

                const safeParticipantName =
                    normalizeParticipantName(
                        participantName
                    );


                const safeMaxViewers =
                    validateMaxViewers(
                        maxViewers
                    );


                return ipcRenderer
                    .invoke(
                        "host:startSession",
                        {
                            participantName:
                                safeParticipantName,

                            maxViewers:
                                safeMaxViewers,
                        }
                    );
            },


        /*
         * =========================
         * ENCERRAR SESSION
         * =========================
         */

        endHostSession:
            () => {

                return ipcRenderer
                    .invoke(
                        "host:endSession"
                    );
            },


        /*
         * =========================
         * DESKTOP SOURCES
         * =========================
         */

        getDesktopSources:
            () => {

                return ipcRenderer
                    .invoke(
                        "desktop:getSources"
                    );
            },


        /*
         * =========================
         * SELECIONAR FONTE
         * =========================
         */

        setSelectedSource:
            (
                sourceId,
                audioMode
            ) => {

                const safeSourceId =
                    validateSourceId(
                        sourceId
                    );


                const safeAudioMode =
                    validateAudioMode(
                        audioMode
                    );


                return ipcRenderer
                    .invoke(
                        "desktop:setSelectedSource",
                        {
                            sourceId:
                                safeSourceId,

                            audioMode:
                                safeAudioMode,
                        }
                    );
            },


        /*
         * =========================
         * PARAR WINDOW AUDIO
         * =========================
         */

        stopWindowAudio:
            () => {

                return ipcRenderer
                    .invoke(
                        "window-audio:stop"
                    );
            },


        /*
         * =========================
         * PCM
         * =========================
         *
         * O Renderer recebe somente
         * os bytes de áudio.
         *
         * O IPC Event nunca é
         * repassado para o React.
         */

        onWindowAudioPCM:
            (
                callback
            ) => {

                const safeCallback =
                    validateCallback(
                        callback
                    );


                let active =
                    true;


                const listener =
                    (
                        _event,
                        data
                    ) => {

                        if (!active) {
                            return;
                        }


                        if (
                            !(
                                data instanceof
                                Uint8Array
                            )
                        ) {
                            return;
                        }


                        if (
                            data.byteLength ===
                            0 ||
                            data.byteLength >
                            MAX_PCM_CHUNK_BYTES
                        ) {
                            return;
                        }


                        /*
                         * Criamos uma cópia própria.
                         *
                         * O Renderer não recebe
                         * diretamente o objeto
                         * originado do IPC.
                         */

                        const safeData =
                            new Uint8Array(
                                data.byteLength
                            );


                        safeData.set(
                            data
                        );


                        safeCallback(
                            safeData
                        );
                    };


                ipcRenderer
                    .on(
                        "window-audio:pcm",
                        listener
                    );


                /*
                 * Cleanup entregue ao React.
                 */

                return () => {

                    if (!active) {
                        return;
                    }


                    active =
                        false;


                    ipcRenderer
                        .removeListener(
                            "window-audio:pcm",
                            listener
                        );
                };
            },
    });


/*
 * =========================
 * CONTEXT BRIDGE
 * =========================
 *
 * Única superfície disponível
 * para o Renderer.
 *
 * NÃO expomos:
 *
 * - ipcRenderer
 * - require
 * - process
 * - fs
 * - child_process
 * - shell
 * - BrowserWindow
 * - funções IPC genéricas
 */

contextBridge
    .exposeInMainWorld(
        "electronAPI",
        electronAPI
    );