import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import {
    AccessToken,
    RoomServiceClient,
} from "livekit-server-sdk";

import {
    neon,
} from "@neondatabase/serverless";

import {
    createHash,
    createHmac,
    randomBytes,
    randomUUID,
    timingSafeEqual,
} from "node:crypto";


dotenv.config();


const app =
    express();


const PORT =
    process.env.PORT ||
    3001;


/*
 * =========================
 * VARIÁVEIS DE AMBIENTE
 * =========================
 */

const {
    LIVEKIT_URL,
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    DATABASE_URL,
    RATE_LIMIT_SALT,
} =
    process.env;


if (
    !LIVEKIT_URL ||
    !LIVEKIT_API_KEY ||
    !LIVEKIT_API_SECRET ||
    !DATABASE_URL ||
    !RATE_LIMIT_SALT
) {
    throw new Error(
        "Variáveis LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, DATABASE_URL e RATE_LIMIT_SALT são obrigatórias."
    );
}


if (
    RATE_LIMIT_SALT.length <
    32
) {
    throw new Error(
        "RATE_LIMIT_SALT deve possuir pelo menos 32 caracteres."
    );
}


/*
 * URL HTTP da API administrativa
 * do LiveKit.
 *
 * Exemplo:
 *
 * wss://xxxx.livekit.cloud
 * ↓
 * https://xxxx.livekit.cloud
 */

const LIVEKIT_API_URL =
    process.env.LIVEKIT_API_URL ||
    LIVEKIT_URL
        .replace(
            /^wss:/,
            "https:"
        )
        .replace(
            /^ws:/,
            "http:"
        );


/*
 * =========================
 * NEON
 * =========================
 */

const sql =
    neon(
        DATABASE_URL
    );


/*
 * =========================
 * LIVEKIT
 * =========================
 */

const roomService =
    new RoomServiceClient(
        LIVEKIT_API_URL,
        LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET
    );


/*
 * =========================
 * LIMITES
 * =========================
 */

const CONNECT_GRACE_MS =
    20_000;


const HOST_MISSING_GRACE_MS =
    15_000;


const MIN_VIEWERS =
    1;


const MAX_VIEWERS =
    12;


const MAX_PARTICIPANT_NAME_LENGTH =
    80;


/*
 * channelId atual:
 *
 * randomBytes(9)
 * → base64url
 * → 12 caracteres
 */

const CHANNEL_ID_PATTERN =
    /^[A-Za-z0-9_-]{12}$/;


/*
 * randomUUID()
 */

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


/*
 * hostSecret e viewerAccess são
 * gerados em base64url.
 *
 * Não exigimos exatamente 43 chars
 * para permitir eventual evolução
 * futura sem quebrar clientes.
 */

const SECRET_PATTERN =
    /^[A-Za-z0-9_-]{32,128}$/;


/*
* =========================
* RATE LIMIT
* =========================
*
* Os limites são compartilhados
* entre todas as instâncias
* serverless através do Neon.
*/

const RATE_LIMIT_CREATE_CHANNEL = {
    scope:
        "create-channel",

    limit:
        10,

    windowSeconds:
        60 * 60,
};


const RATE_LIMIT_START_SESSION = {
    scope:
        "start-session",

    limit:
        20,

    windowSeconds:
        5 * 60,
};


const RATE_LIMIT_END_SESSION = {
    scope:
        "end-session",

    /*
     * Mantemos mais folgado porque
     * encerrar uma transmissão é uma
     * operação importante de cleanup.
     */

    limit:
        60,

    windowSeconds:
        5 * 60,
};


const RATE_LIMIT_VIEWER_TOKEN = {
    scope:
        "viewer-token",

    limit:
        60,

    windowSeconds:
        60,
};


const RATE_LIMIT_STATUS = {
    scope:
        "session-status",

    limit:
        180,

    windowSeconds:
        60,
};


/*
 * =========================
 * CORS
 * =========================
 */

const allowedOrigins =
    (
        process.env.ALLOWED_ORIGINS ||
        "http://localhost:5173,http://localhost:5174"
    )
        .split(
            ","
        )
        .map(
            (origin) =>
                origin
                    .trim()
                    .replace(
                        /\/+$/,
                        ""
                    )
        )
        .filter(
            Boolean
        );


/*
 * =========================
 * CONFIGURAÇÃO EXPRESS
 * =========================
 */

app.disable(
    "x-powered-by"
);


/*
 * A Vercel trabalha atrás
 * de proxy reverso.
 */

app.set(
    "trust proxy",
    1
);


/*
 * =========================
 * HEADERS DE SEGURANÇA
 * =========================
 *
 * Este servidor só entrega JSON.
 */

app.use(
    (
        _req,
        res,
        next
    ) => {

        /*
         * Tokens, hostSecret e estado
         * de sessão nunca devem ser
         * armazenados em cache.
         */

        res.setHeader(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate"
        );


        res.setHeader(
            "Pragma",
            "no-cache"
        );


        res.setHeader(
            "Expires",
            "0"
        );


        /*
         * Não permitir MIME sniffing.
         */

        res.setHeader(
            "X-Content-Type-Options",
            "nosniff"
        );


        /*
         * Nenhum dado deste backend
         * precisa ser enviado como
         * Referer para outro domínio.
         */

        res.setHeader(
            "Referrer-Policy",
            "no-referrer"
        );


        /*
         * API não deve ser colocada
         * dentro de iframe.
         */

        res.setHeader(
            "X-Frame-Options",
            "DENY"
        );


        /*
         * Como só entregamos JSON,
         * nenhuma página deste domínio
         * deve executar conteúdo.
         */

        res.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        );


        /*
         * API não precisa de acesso
         * a sensores ou dispositivos.
         */

        res.setHeader(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=()"
        );


        next();
    }
);


/*
 * =========================
 * CORS
 * =========================
 */

app.use(
    cors({
        origin(
            origin,
            callback
        ) {
            /*
             * O Electron Main utiliza
             * fetch do Node e não envia
             * Origin.
             */

            if (!origin) {
                return callback(
                    null,
                    true
                );
            }


            const normalizedOrigin =
                origin.replace(
                    /\/+$/,
                    ""
                );


            if (
                allowedOrigins.includes(
                    normalizedOrigin
                )
            ) {
                return callback(
                    null,
                    true
                );
            }


            const error =
                new Error(
                    "Origin não permitida."
                );


            error.statusCode =
                403;


            return callback(
                error
            );
        },


        methods: [
            "GET",
            "POST",
            "OPTIONS",
        ],


        allowedHeaders: [
            "Content-Type",
        ],


        credentials:
            false,


        maxAge:
            600,


        optionsSuccessStatus:
            204,
    })
);


/*
 * Máximo de 16 KB por JSON.
 *
 * Nenhuma rota do ShareRoom precisa
 * receber payload grande.
 */

app.use(
    express.json({
        limit:
            "16kb",
    })
);


/*
 * =========================
 * LOG SEGURO
 * =========================
 */

function logServerError(
    context,
    error
) {
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
 * IDENTIFICAR CLIENTE
 * =========================
 *
 * O endereço é utilizado apenas
 * temporariamente para gerar um
 * HMAC.
 *
 * O IP em texto NÃO é armazenado
 * no Neon.
 */

function getClientAddress(
    req
) {
    /*
     * Na Vercel usamos o endereço
     * encaminhado pela própria
     * infraestrutura.
     */

    if (
        process.env.VERCEL
    ) {
        const forwarded =
            req.get(
                "x-vercel-forwarded-for"
            );


        if (
            forwarded
        ) {
            const firstAddress =
                forwarded
                    .split(
                        ","
                    )[0]
                    ?.trim();


            if (
                firstAddress
            ) {
                return firstAddress
                    .slice(
                        0,
                        100
                    );
            }
        }
    }


    /*
     * Desenvolvimento local.
     */

    const fallback =
        req.ip ||
        req.socket
            ?.remoteAddress ||
        "unknown";


    return String(
        fallback
    )
        .trim()
        .slice(
            0,
            100
        );
}


/*
 * =========================
 * CHAVE PRIVADA DO RATE LIMIT
 * =========================
 *
 * Não usamos SHA-256 simples:
 *
 * HMAC(
 *   RATE_LIMIT_SALT,
 *   scope + IP
 * )
 *
 * Assim nem mesmo o hash permite
 * testar facilmente uma lista
 * conhecida de endereços IP.
 */

function createRateLimitKey(
    scope,
    clientAddress
) {
    return createHmac(
        "sha256",
        RATE_LIMIT_SALT
    )
        .update(
            `${scope}:${clientAddress}`
        )
        .digest(
            "hex"
        );
}


/*
 * =========================
 * CONSUMIR RATE LIMIT
 * =========================
 *
 * Uma única query faz o incremento
 * de forma atômica no PostgreSQL.
 *
 * Se a janela expirou:
 * contador volta para 1.
 *
 * Se ainda está ativa:
 * incrementa.
 */

async function consumeRateLimit(
    req,
    {
        scope,
        limit,
        windowSeconds,
    }
) {
    const clientAddress =
        getClientAddress(
            req
        );


    const keyHash =
        createRateLimitKey(
            scope,
            clientAddress
        );


    const rows =
        await sql`
            INSERT INTO api_rate_limits (
                key_hash,
                window_started_at,
                request_count,
                updated_at
            )
            VALUES (
                ${keyHash},
                NOW(),
                1,
                NOW()
            )

            ON CONFLICT (key_hash)

            DO UPDATE SET

                request_count =
                    CASE
                        WHEN
                            api_rate_limits.window_started_at
                            <=
                            NOW() -
                            (
                                ${windowSeconds}
                                *
                                INTERVAL '1 second'
                            )
                        THEN
                            1

                        ELSE
                            api_rate_limits.request_count + 1
                    END,

                window_started_at =
                    CASE
                        WHEN
                            api_rate_limits.window_started_at
                            <=
                            NOW() -
                            (
                                ${windowSeconds}
                                *
                                INTERVAL '1 second'
                            )
                        THEN
                            NOW()

                        ELSE
                            api_rate_limits.window_started_at
                    END,

                updated_at =
                    NOW()

            RETURNING
                request_count,
                window_started_at
        `;


    const row =
        rows[0];


    if (
        !row
    ) {
        throw new Error(
            "Falha ao aplicar rate limit."
        );
    }


    const requestCount =
        Number(
            row.request_count
        );


    const windowStartedAt =
        new Date(
            row.window_started_at
        )
            .getTime();


    if (
        !Number.isInteger(
            requestCount
        ) ||
        !Number.isFinite(
            windowStartedAt
        )
    ) {
        throw new Error(
            "Estado inválido do rate limit."
        );
    }


    const resetAt =
        windowStartedAt +
        (
            windowSeconds *
            1000
        );


    const retryAfter =
        Math.max(
            1,

            Math.ceil(
                (
                    resetAt -
                    Date.now()
                ) /
                1000
            )
        );


    return {
        allowed:
            requestCount <=
            limit,

        requestCount,

        remaining:
            Math.max(
                0,
                limit -
                requestCount
            ),

        retryAfter,
    };
}


/*
 * =========================
 * MIDDLEWARE RATE LIMIT
 * =========================
 */

function rateLimit(
    configuration
) {
    return async (
        req,
        res,
        next
    ) => {

        try {
            const result =
                await consumeRateLimit(
                    req,
                    configuration
                );


            res.setHeader(
                "X-RateLimit-Limit",
                String(
                    configuration.limit
                )
            );


            res.setHeader(
                "X-RateLimit-Remaining",
                String(
                    result.remaining
                )
            );


            if (
                !result.allowed
            ) {
                res.setHeader(
                    "Retry-After",
                    String(
                        result.retryAfter
                    )
                );


                return res
                    .status(
                        429
                    )
                    .json({
                        error:
                            "RATE_LIMIT_EXCEEDED",

                        retryAfter:
                            result.retryAfter,
                    });
            }


            next();

        } catch (error) {
            /*
             * Se o armazenamento do
             * rate limit falhar, não
             * ignoramos silenciosamente.
             *
             * A requisição vai para o
             * error handler.
             */

            next(
                error
            );
        }
    };
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


function normalizeParticipantName(
    value,
    fallback
) {
    if (
        typeof value !==
        "string"
    ) {
        return fallback;
    }


    const normalized =
        value
            /*
             * Remove caracteres de controle.
             */
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
        fallback
    );
}


/*
 * Todas as rotas com :channelId
 * passam por essa validação antes
 * de consultar o Neon.
 */

app.param(
    "channelId",
    (
        _req,
        res,
        next,
        channelId
    ) => {

        if (
            !isValidChannelId(
                channelId
            )
        ) {
            return res
                .status(
                    400
                )
                .json({
                    error:
                        "INVALID_CHANNEL_ID",
                });
        }


        next();
    }
);


/*
 * =========================
 * ROTAS EXCLUSIVAS DO HOST
 * =========================
 *
 * start/end/create Channel são usados
 * pelo Electron Main.
 *
 * O Viewer web não deve conseguir
 * chamar essas rotas diretamente
 * através de um navegador normal.
 *
 * Isso NÃO substitui hostSecret.
 * É apenas uma camada adicional.
 */

function requireDesktopRequest(
    req,
    res,
    next
) {
    const origin =
        req.get(
            "origin"
        );


    if (origin) {
        return res
            .status(
                403
            )
            .json({
                error:
                    "HOST_ROUTE_NOT_AVAILABLE_FROM_BROWSER",
            });
    }


    next();
}


/*
 * =========================
 * HASH
 * =========================
 */

function hashSecret(
    secret
) {
    return createHash(
        "sha256"
    )
        .update(
            String(
                secret
            )
        )
        .digest(
            "hex"
        );
}


/*
 * =========================
 * COMPARAÇÃO SEGURA
 * =========================
 */

function safeSecretCompare(
    secret,
    expectedHash
) {
    if (
        !isValidSecret(
            secret
        ) ||
        !expectedHash
    ) {
        return false;
    }


    const actualHash =
        hashSecret(
            secret
        );


    const actualBuffer =
        Buffer.from(
            actualHash,
            "utf8"
        );


    const expectedBuffer =
        Buffer.from(
            expectedHash,
            "utf8"
        );


    if (
        actualBuffer.length !==
        expectedBuffer.length
    ) {
        return false;
    }


    return timingSafeEqual(
        actualBuffer,
        expectedBuffer
    );
}


/*
 * =========================
 * CHANNEL DB MODEL
 * =========================
 */

function databaseRowToChannel(
    row
) {
    if (!row) {
        return null;
    }


    return {
        channelId:
            row.channel_id,

        hostSecretHash:
            row.host_secret_hash,

        createdAt:
            row.created_at,


        activeSessionId:
            row.active_session_id,

        roomName:
            row.room_name,

        hostIdentity:
            row.host_identity,

        startedAt:
            row.started_at,

        hostMissingSince:
            row.host_missing_since,


        viewerAccessHash:
            row.viewer_access_hash,

        maxViewers:
            row.max_viewers,
    };
}


/*
 * =========================
 * GET CHANNEL
 * =========================
 */

async function getChannel(
    channelId
) {
    const rows =
        await sql`
            SELECT
                channel_id,
                host_secret_hash,
                created_at,
                active_session_id,
                room_name,
                host_identity,
                started_at,
                host_missing_since,
                viewer_access_hash,
                max_viewers
            FROM channels
            WHERE channel_id = ${channelId}
            LIMIT 1
        `;


    return databaseRowToChannel(
        rows[0]
    );
}


/*
 * =========================
 * CREATE CHANNEL
 * =========================
 */

async function createChannel(
    channelId,
    hostSecretHash
) {
    const rows =
        await sql`
            INSERT INTO channels (
                channel_id,
                host_secret_hash
            )
            VALUES (
                ${channelId},
                ${hostSecretHash}
            )
            RETURNING
                channel_id,
                host_secret_hash,
                created_at,
                active_session_id,
                room_name,
                host_identity,
                started_at,
                host_missing_since,
                viewer_access_hash,
                max_viewers
        `;


    return databaseRowToChannel(
        rows[0]
    );
}


/*
 * =========================
 * LIMPAR SESSÃO
 * =========================
 */

async function clearActiveSessionIfCurrent(
    channelId,
    sessionId
) {
    if (
        !isValidSessionId(
            sessionId
        )
    ) {
        return false;
    }


    const rows =
        await sql`
            UPDATE channels
            SET
                active_session_id = NULL,
                room_name = NULL,
                host_identity = NULL,
                started_at = NULL,
                host_missing_since = NULL,
                viewer_access_hash = NULL,
                max_viewers = NULL
            WHERE channel_id = ${channelId}
              AND active_session_id = ${sessionId}::uuid
            RETURNING channel_id
        `;


    return (
        rows.length >
        0
    );
}


/*
 * =========================
 * HOST AUSENTE
 * =========================
 */

async function setHostMissingSinceIfCurrent(
    channelId,
    sessionId
) {
    if (
        !isValidSessionId(
            sessionId
        )
    ) {
        return;
    }


    await sql`
        UPDATE channels
        SET host_missing_since = NOW()
        WHERE channel_id = ${channelId}
          AND active_session_id = ${sessionId}::uuid
          AND host_missing_since IS NULL
    `;
}


async function clearHostMissingSinceIfCurrent(
    channelId,
    sessionId
) {
    if (
        !isValidSessionId(
            sessionId
        )
    ) {
        return;
    }


    await sql`
        UPDATE channels
        SET host_missing_since = NULL
        WHERE channel_id = ${channelId}
          AND active_session_id = ${sessionId}::uuid
          AND host_missing_since IS NOT NULL
    `;
}


/*
 * =========================
 * CLAIM SESSION
 * =========================
 */

async function claimNewSession({
    channelId,
    sessionId,
    roomName,
    hostIdentity,
    viewerAccessHash,
    maxViewers,
}) {
    const rows =
        await sql`
            UPDATE channels
            SET
                active_session_id = ${sessionId}::uuid,
                room_name = ${roomName},
                host_identity = ${hostIdentity},
                started_at = NOW(),
                host_missing_since = NULL,
                viewer_access_hash = ${viewerAccessHash},
                max_viewers = ${maxViewers}
            WHERE channel_id = ${channelId}
              AND active_session_id IS NULL
            RETURNING channel_id
        `;


    return (
        rows.length >
        0
    );
}


/*
 * =========================
 * REMOVER ROOM
 * =========================
 */

async function safeDeleteRoom(
    roomName
) {
    if (
        !roomName ||
        typeof roomName !==
        "string"
    ) {
        return;
    }


    try {
        await roomService
            .deleteRoom(
                roomName
            );

    } catch (error) {
        /*
         * Pode acontecer normalmente
         * quando a Room já desapareceu.
         *
         * Não retornamos detalhes
         * para o cliente.
         */

        logServerError(
            "Falha ao remover Room",
            error
        );
    }
}


/*
 * =========================
 * VALIDAR HOST
 * =========================
 */

function validateHost(
    channel,
    hostSecret
) {
    return safeSecretCompare(
        hostSecret,
        channel
            ?.hostSecretHash
    );
}


/*
 * =========================
 * VALIDAR VIEWER
 * =========================
 */

function validateViewerAccess(
    channel,
    sessionId,
    viewerAccess
) {
    if (!channel) {
        return false;
    }


    if (
        !isValidSessionId(
            sessionId
        ) ||
        !isValidSecret(
            viewerAccess
        )
    ) {
        return false;
    }


    if (
        !channel.activeSessionId
    ) {
        return false;
    }


    if (
        String(
            channel.activeSessionId
        ) !==
        String(
            sessionId
        )
    ) {
        return false;
    }


    return safeSecretCompare(
        viewerAccess,
        channel.viewerAccessHash
    );
}


/*
 * =========================
 * SESSÃO AINDA ESTÁ LIVE?
 * =========================
 */

async function isSessionLive(
    channel
) {
    if (
        !channel
            ?.activeSessionId ||
        !channel
            ?.roomName ||
        !channel
            ?.hostIdentity
    ) {
        return false;
    }


    const sessionId =
        String(
            channel.activeSessionId
        );


    if (
        !isValidSessionId(
            sessionId
        )
    ) {
        return false;
    }


    try {
        const rooms =
            await roomService
                .listRooms(
                    [
                        channel.roomName,
                    ]
                );


        const roomExists =
            rooms.some(
                (room) =>
                    room.name ===
                    channel.roomName
            );


        /*
         * Room ainda não apareceu no
         * LiveKit logo após o Start.
         */

        if (!roomExists) {
            const startedAt =
                channel.startedAt
                    ? new Date(
                        channel.startedAt
                    )
                        .getTime()
                    : 0;


            const sessionAge =
                Date.now() -
                startedAt;


            if (
                startedAt &&
                sessionAge <
                CONNECT_GRACE_MS
            ) {
                return true;
            }


            await clearActiveSessionIfCurrent(
                channel.channelId,
                sessionId
            );


            return false;
        }


        const participants =
            await roomService
                .listParticipants(
                    channel.roomName
                );


        const hostPresent =
            participants.some(
                (participant) =>
                    participant.identity ===
                    channel.hostIdentity
            );


        /*
         * Host voltou/continua presente.
         */

        if (hostPresent) {
            if (
                channel.hostMissingSince
            ) {
                await clearHostMissingSinceIfCurrent(
                    channel.channelId,
                    sessionId
                );
            }


            return true;
        }


        /*
         * Durante os primeiros segundos
         * ainda damos tempo para o Host
         * conectar.
         */

        const startedAt =
            channel.startedAt
                ? new Date(
                    channel.startedAt
                )
                    .getTime()
                : 0;


        if (
            startedAt &&
            Date.now() -
            startedAt <
            CONNECT_GRACE_MS
        ) {
            return true;
        }


        /*
         * Primeira observação de
         * Host ausente.
         */

        if (
            !channel.hostMissingSince
        ) {
            await setHostMissingSinceIfCurrent(
                channel.channelId,
                sessionId
            );


            return true;
        }


        const missingSince =
            new Date(
                channel.hostMissingSince
            )
                .getTime();


        /*
         * Pequena tolerância para
         * reconexões temporárias.
         */

        if (
            Date.now() -
            missingSince <
            HOST_MISSING_GRACE_MS
        ) {
            return true;
        }


        /*
         * Host realmente desapareceu.
         */

        await clearActiveSessionIfCurrent(
            channel.channelId,
            sessionId
        );


        await safeDeleteRoom(
            channel.roomName
        );


        return false;

    } catch (error) {
        /*
         * Nunca apagamos a sessão do
         * banco simplesmente porque
         * houve uma falha temporária
         * consultando o LiveKit.
         */

        logServerError(
            "Falha ao consultar LiveKit",
            error
        );


        return true;
    }
}


/*
 * =========================
 * TOKEN LIVEKIT
 * =========================
 */

async function createLiveKitToken({
    identity,
    name,
    roomName,
    canPublish,
    canSubscribe,
}) {
    const token =
        new AccessToken(
            LIVEKIT_API_KEY,
            LIVEKIT_API_SECRET,
            {
                identity,

                name,

                /*
                 * A Session do ShareRoom
                 * controla a vida real
                 * da transmissão.
                 *
                 * O Room também é destruído
                 * no encerramento.
                 */

                ttl:
                    "6h",
            }
        );


    token.addGrant({
        roomJoin:
            true,

        room:
            roomName,

        canPublish,

        canSubscribe,

        /*
         * ShareRoom não utiliza
         * mensagens/DataChannel.
         */

        canPublishData:
            false,
    });


    return token
        .toJwt();
}


/*
 * =========================
 * HEALTH CHECK
 * =========================
 */

app.get(
    "/",
    (
        _req,
        res
    ) => {

        res.json({
            name:
                "ShareRoom Server",

            status:
                "online",
        });
    }
);


/*
 * =========================
 * CRIAR CHANNEL
 * =========================
 *
 * Chamado somente pelo
 * Electron Main.
 *
 * O hostSecret é devolvido
 * uma única vez.
 */

app.post(
    "/channels",
    requireDesktopRequest,
    rateLimit(
        RATE_LIMIT_CREATE_CHANNEL
    ),
    async (
        _req,
        res,
        next
    ) => {

        try {
            const channelId =
                randomBytes(
                    9
                )
                    .toString(
                        "base64url"
                    );


            const hostSecret =
                randomBytes(
                    32
                )
                    .toString(
                        "base64url"
                    );


            await createChannel(
                channelId,
                hashSecret(
                    hostSecret
                )
            );


            res
                .status(
                    201
                )
                .json({
                    channelId,
                    hostSecret,
                });

        } catch (error) {
            next(
                error
            );
        }
    }
);


/*
 * =========================
 * INICIAR TRANSMISSÃO
 * =========================
 */

app.post(
    "/channels/:channelId/start",
    requireDesktopRequest,
    rateLimit(
        RATE_LIMIT_START_SESSION
    ),
    async (
        req,
        res,
        next
    ) => {

        try {
            const {
                channelId,
            } =
                req.params;


            const {
                hostSecret,
                participantName:
                rawParticipantName,
                maxViewers =
                4,
            } =
                req.body ||
                {};


            const channel =
                await getChannel(
                    channelId
                );


            if (!channel) {
                return res
                    .status(
                        404
                    )
                    .json({
                        error:
                            "CHANNEL_NOT_FOUND",
                    });
            }


            /*
             * Não diferenciamos segredo
             * malformado de segredo errado.
             */

            if (
                !validateHost(
                    channel,
                    hostSecret
                )
            ) {
                return res
                    .status(
                        401
                    )
                    .json({
                        error:
                            "INVALID_HOST_SECRET",
                    });
            }


            const parsedMaxViewers =
                Number(
                    maxViewers
                );


            if (
                !Number.isInteger(
                    parsedMaxViewers
                ) ||
                parsedMaxViewers <
                MIN_VIEWERS ||
                parsedMaxViewers >
                MAX_VIEWERS
            ) {
                return res
                    .status(
                        400
                    )
                    .json({
                        error:
                            "INVALID_MAX_VIEWERS",

                        message:
                            `O limite de espectadores deve estar entre ${MIN_VIEWERS} e ${MAX_VIEWERS}.`,
                    });
            }


            const participantName =
                normalizeParticipantName(
                    rawParticipantName,
                    "Host"
                );


            /*
             * =========================
             * FINALIZAR SESSÃO ANTIGA
             * =========================
             */

            if (
                channel
                    .activeSessionId &&
                channel
                    .roomName
            ) {
                await clearActiveSessionIfCurrent(
                    channel.channelId,
                    String(
                        channel.activeSessionId
                    )
                );


                await safeDeleteRoom(
                    channel.roomName
                );
            }


            /*
             * =========================
             * NOVA SESSION
             * =========================
             */

            const sessionId =
                randomUUID();


            /*
             * Credencial exclusiva
             * desta transmissão.
             */

            const viewerAccess =
                randomBytes(
                    32
                )
                    .toString(
                        "base64url"
                    );


            const viewerAccessHash =
                hashSecret(
                    viewerAccess
                );


            const roomName =
                `shareroom-${channelId}-${sessionId}`;


            const hostIdentity =
                `host-${channelId}-${sessionId}`;


            /*
             * Host ocupa uma vaga.
             *
             * maxViewers = 4
             * ↓
             * maxParticipants = 5
             */

            await roomService
                .createRoom({
                    name:
                        roomName,

                    emptyTimeout:
                        60,

                    departureTimeout:
                        30,

                    maxParticipants:
                        parsedMaxViewers +
                        1,
                });


            /*
             * Apenas uma Session pode
             * vencer a corrida no banco.
             */

            const claimed =
                await claimNewSession({
                    channelId,

                    sessionId,

                    roomName,

                    hostIdentity,

                    viewerAccessHash,

                    maxViewers:
                        parsedMaxViewers,
                });


            if (!claimed) {
                await safeDeleteRoom(
                    roomName
                );


                return res
                    .status(
                        409
                    )
                    .json({
                        error:
                            "SESSION_ALREADY_ACTIVE",
                    });
            }


            /*
             * Host:
             *
             * publica tela/áudio,
             * mas não precisa assinar
             * tracks dos Viewers.
             */

            const token =
                await createLiveKitToken({
                    identity:
                        hostIdentity,

                    name:
                        participantName,

                    roomName,

                    canPublish:
                        true,

                    canSubscribe:
                        false,
                });


            res.json({
                serverUrl:
                    LIVEKIT_URL,

                token,

                channelId,

                sessionId,

                /*
                 * Somente o Desktop
                 * recebe esta chave.
                 *
                 * Neon possui apenas
                 * o SHA-256.
                 */

                viewerAccess,

                maxViewers:
                    parsedMaxViewers,
            });

        } catch (error) {
            next(
                error
            );
        }
    }
);


/*
 * =========================
 * ENCERRAR TRANSMISSÃO
 * =========================
 */

app.post(
    "/channels/:channelId/end",
    requireDesktopRequest,
    rateLimit(
        RATE_LIMIT_END_SESSION
    ),
    async (
        req,
        res,
        next
    ) => {

        try {
            const {
                channelId,
            } =
                req.params;


            const {
                hostSecret,
                sessionId,
            } =
                req.body ||
                {};


            const channel =
                await getChannel(
                    channelId
                );


            if (!channel) {
                return res
                    .status(
                        404
                    )
                    .json({
                        error:
                            "CHANNEL_NOT_FOUND",
                    });
            }


            if (
                !validateHost(
                    channel,
                    hostSecret
                )
            ) {
                return res
                    .status(
                        401
                    )
                    .json({
                        error:
                            "INVALID_HOST_SECRET",
                    });
            }


            /*
             * A Session ID passa a ser
             * obrigatória.
             *
             * Isso impede um Host antigo
             * ou bugado de encerrar uma
             * transmissão posterior.
             */

            if (
                !isValidSessionId(
                    sessionId
                )
            ) {
                return res
                    .status(
                        400
                    )
                    .json({
                        error:
                            "INVALID_SESSION_ID",
                    });
            }


            /*
             * Idempotência:
             * já encerrou = sucesso.
             */

            if (
                !channel
                    .activeSessionId
            ) {
                return res.json({
                    ok:
                        true,

                    alreadyEnded:
                        true,
                });
            }


            /*
             * Nunca encerramos uma
             * Session diferente.
             */

            if (
                String(
                    channel.activeSessionId
                ) !==
                String(
                    sessionId
                )
            ) {
                return res
                    .status(
                        409
                    )
                    .json({
                        code:
                            "SESSION_MISMATCH",

                        error:
                            "SESSION_MISMATCH",
                    });
            }


            const roomName =
                channel.roomName;


            const cleared =
                await clearActiveSessionIfCurrent(
                    channel.channelId,
                    sessionId
                );


            /*
             * Se outra requisição já
             * mudou a Session, não
             * removemos Room errada.
             */

            if (!cleared) {
                return res
                    .status(
                        409
                    )
                    .json({
                        code:
                            "SESSION_MISMATCH",

                        error:
                            "SESSION_MISMATCH",
                    });
            }


            await safeDeleteRoom(
                roomName
            );


            res.json({
                ok:
                    true,
            });

        } catch (error) {
            next(
                error
            );
        }
    }
);


/*
 * =========================
 * TOKEN DO VIEWER
 * =========================
 */

app.post(
    "/channels/:channelId/viewer-token",
    rateLimit(
        RATE_LIMIT_VIEWER_TOKEN
    ),
    async (
        req,
        res,
        next
    ) => {

        try {
            const {
                channelId,
            } =
                req.params;


            const {
                sessionId,
                viewerAccess,
                participantName:
                rawParticipantName,
            } =
                req.body ||
                {};


            /*
             * Validação ANTES do cast UUID
             * ou de qualquer operação
             * sensível.
             */

            if (
                !isValidSessionId(
                    sessionId
                )
            ) {
                return res
                    .status(
                        400
                    )
                    .json({
                        error:
                            "INVALID_SESSION_ID",
                    });
            }


            if (
                !isValidSecret(
                    viewerAccess
                )
            ) {
                return res
                    .status(
                        403
                    )
                    .json({
                        error:
                            "INVALID_VIEWER_ACCESS",
                    });
            }


            let channel =
                await getChannel(
                    channelId
                );


            if (!channel) {
                return res
                    .status(
                        404
                    )
                    .json({
                        error:
                            "CHANNEL_NOT_FOUND",
                    });
            }


            /*
             * Link antigo nunca recebe
             * dados da Session atual.
             */

            if (
                !channel
                    .activeSessionId ||
                String(
                    channel.activeSessionId
                ) !==
                String(
                    sessionId
                )
            ) {
                return res
                    .status(
                        410
                    )
                    .json({
                        error:
                            "SESSION_ENDED",
                    });
            }


            if (
                !validateViewerAccess(
                    channel,
                    sessionId,
                    viewerAccess
                )
            ) {
                return res
                    .status(
                        403
                    )
                    .json({
                        error:
                            "INVALID_VIEWER_ACCESS",
                    });
            }


            const live =
                await isSessionLive(
                    channel
                );


            if (!live) {
                return res
                    .status(
                        410
                    )
                    .json({
                        error:
                            "SESSION_ENDED",
                    });
            }


            /*
             * isSessionLive pode ter
             * atualizado o banco.
             */

            channel =
                await getChannel(
                    channelId
                );


            if (
                !channel ||
                String(
                    channel.activeSessionId
                ) !==
                String(
                    sessionId
                )
            ) {
                return res
                    .status(
                        410
                    )
                    .json({
                        error:
                            "SESSION_ENDED",
                    });
            }


            /*
             * =========================
             * LIMITE DE VIEWERS
             * =========================
             */

            const participants =
                await roomService
                    .listParticipants(
                        channel.roomName
                    );


            const viewerCount =
                participants
                    .filter(
                        (
                            participant
                        ) =>
                            participant.identity !==
                            channel.hostIdentity
                    )
                    .length;


            if (
                viewerCount >=
                Number(
                    channel.maxViewers
                )
            ) {
                return res
                    .status(
                        429
                    )
                    .json({
                        error:
                            "VIEWER_LIMIT_REACHED",

                        message:
                            "Esta transmissão atingiu o limite de espectadores.",
                    });
            }


            const viewerIdentity =
                `viewer-${randomUUID()}`;


            const participantName =
                normalizeParticipantName(
                    rawParticipantName,
                    "Viewer"
                );


            /*
             * Viewer:
             * pode apenas receber.
             */

            const token =
                await createLiveKitToken({
                    identity:
                        viewerIdentity,

                    name:
                        participantName,

                    roomName:
                        channel.roomName,

                    canPublish:
                        false,

                    canSubscribe:
                        true,
                });


            res.json({
                serverUrl:
                    LIVEKIT_URL,

                token,

                sessionId,

                maxViewers:
                    channel.maxViewers,
            });

        } catch (error) {
            next(
                error
            );
        }
    }
);


/*
 * =========================
 * STATUS DA SESSION
 * =========================
 *
 * IMPORTANTE:
 *
 * Antes:
 *
 * GET /status?sessionId=...&access=...
 *
 * Agora:
 *
 * POST /status
 *
 * {
 *   sessionId,
 *   viewerAccess
 * }
 *
 * Assim a chave não fica registrada
 * em query strings, histórico de proxy
 * ou access logs.
 */

app.post(
    "/channels/:channelId/status",
    rateLimit(
        RATE_LIMIT_STATUS
    ),
    async (
        req,
        res,
        next
    ) => {

        try {
            const {
                channelId,
            } =
                req.params;


            const {
                sessionId,
                viewerAccess,
            } =
                req.body ||
                {};


            if (
                !isValidSessionId(
                    sessionId
                )
            ) {
                return res
                    .status(
                        400
                    )
                    .json({
                        error:
                            "INVALID_SESSION_ID",
                    });
            }


            if (
                !isValidSecret(
                    viewerAccess
                )
            ) {
                return res
                    .status(
                        403
                    )
                    .json({
                        error:
                            "INVALID_VIEWER_ACCESS",
                    });
            }


            let channel =
                await getChannel(
                    channelId
                );


            if (!channel) {
                return res
                    .status(
                        404
                    )
                    .json({
                        error:
                            "CHANNEL_NOT_FOUND",
                    });
            }


            /*
             * Link antigo:
             *
             * responde simplesmente que
             * aquela transmissão acabou.
             *
             * Não revelamos dados da
             * transmissão nova.
             */

            if (
                !channel
                    .activeSessionId ||
                String(
                    channel.activeSessionId
                ) !==
                String(
                    sessionId
                )
            ) {
                return res.json({
                    live:
                        false,

                    ended:
                        true,
                });
            }


            if (
                !validateViewerAccess(
                    channel,
                    sessionId,
                    viewerAccess
                )
            ) {
                return res
                    .status(
                        403
                    )
                    .json({
                        error:
                            "INVALID_VIEWER_ACCESS",
                    });
            }


            const live =
                await isSessionLive(
                    channel
                );


            if (!live) {
                return res.json({
                    live:
                        false,

                    ended:
                        true,
                });
            }


            channel =
                await getChannel(
                    channelId
                );


            if (
                !channel ||
                String(
                    channel.activeSessionId
                ) !==
                String(
                    sessionId
                )
            ) {
                return res.json({
                    live:
                        false,

                    ended:
                        true,
                });
            }


            const participants =
                await roomService
                    .listParticipants(
                        channel.roomName
                    );


            const viewers =
                participants
                    .filter(
                        (
                            participant
                        ) =>
                            participant
                                .identity !==
                            channel
                                .hostIdentity
                    )
                    .length;


            res.json({
                live:
                    true,

                ended:
                    false,

                viewers,

                maxViewers:
                    channel.maxViewers,
            });

        } catch (error) {
            next(
                error
            );
        }
    }
);


/*
 * =========================
 * 404
 * =========================
 */

app.use(
    (
        _req,
        res
    ) => {

        res
            .status(
                404
            )
            .json({
                error:
                    "NOT_FOUND",
            });
    }
);


/*
 * =========================
 * ERROR HANDLER
 * =========================
 */

app.use(
    (
        error,
        _req,
        res,
        _next
    ) => {

        /*
         * JSON inválido.
         */

        if (
            error?.type ===
            "entity.parse.failed"
        ) {
            return res
                .status(
                    400
                )
                .json({
                    error:
                        "INVALID_JSON",
                });
        }


        /*
         * Payload acima de 16 KB.
         */

        if (
            error?.type ===
            "entity.too.large" ||
            error?.status ===
            413
        ) {
            return res
                .status(
                    413
                )
                .json({
                    error:
                        "PAYLOAD_TOO_LARGE",
                });
        }


        /*
         * CORS.
         */

        if (
            error?.statusCode ===
            403
        ) {
            return res
                .status(
                    403
                )
                .json({
                    error:
                        "ORIGIN_NOT_ALLOWED",
                });
        }


        /*
         * Erro interno.
         *
         * O cliente nunca recebe:
         *
         * - stack
         * - mensagem do Neon
         * - segredo
         * - detalhes do LiveKit
         */

        logServerError(
            "Erro interno",
            error
        );


        return res
            .status(
                500
            )
            .json({
                error:
                    "INTERNAL_SERVER_ERROR",
            });
    }
);


/*
 * =========================
 * LOCAL
 * =========================
 *
 * Na Vercel exportamos apenas
 * o Express.
 */

if (
    !process.env.VERCEL
) {
    app.listen(
        PORT,
        () => {

            console.log(
                `ShareRoom Server rodando em http://localhost:${PORT}`
            );
        }
    );
}


export default app;