#include <cstdio>
#include <vector>
#include <iostream>
#include <audioclientactivationparams.h>

#include "LoopbackCapture.h"


#define BITS_PER_BYTE 8


/*
 * =========================
 * ESTADO DE ERRO
 * =========================
 */

HRESULT CLoopbackCapture::SetDeviceStateErrorIfFailed(
    HRESULT hr
)
{
    if (FAILED(hr))
    {
        m_DeviceState =
            DeviceState::Error;
    }


    return hr;
}


/*
 * =========================
 * INICIALIZAÇÃO COMUM
 * =========================
 */

HRESULT CLoopbackCapture::InitializeLoopbackCapture()
{
    /*
     * Evento disparado quando
     * o WASAPI possui áudio.
     */

    RETURN_IF_FAILED(
        m_SampleReadyEvent.create(
            wil::EventOptions::None
        )
    );


    /*
     * Media Foundation.
     */

    RETURN_IF_FAILED(
        MFStartup(
            MF_VERSION,
            MFSTARTUP_LITE
        )
    );


    /*
     * Work queue dedicada
     * ao processamento de áudio.
     */

    DWORD dwTaskID =
        0;


    RETURN_IF_FAILED(
        MFLockSharedWorkQueue(
            L"Capture",
            0,
            &dwTaskID,
            &m_dwQueueID
        )
    );


    m_xSampleReady.SetQueueID(
        m_dwQueueID
    );


    /*
     * Eventos internos.
     */

    RETURN_IF_FAILED(
        m_hActivateCompleted.create(
            wil::EventOptions::None
        )
    );


    RETURN_IF_FAILED(
        m_hCaptureStopped.create(
            wil::EventOptions::None
        )
    );


    return S_OK;
}


/*
 * =========================
 * DESTRUTOR
 * =========================
 */

CLoopbackCapture::~CLoopbackCapture()
{
    if (
        m_dwQueueID !=
        0
    )
    {
        MFUnlockWorkQueue(
            m_dwQueueID
        );


        m_dwQueueID =
            0;
    }
}


/*
 * =========================
 * CONFIGURAR AUDIO CLIENT
 * =========================
 *
 * Esta configuração é compartilhada
 * pelos dois modos:
 *
 * PROCESS
 * SYSTEM
 *
 * A saída entregue ao Electron será:
 *
 * PCM
 * 44.1 kHz
 * Stereo
 * 16-bit
 * Little-endian
 */

HRESULT CLoopbackCapture::ConfigureAudioClient()
{
    return SetDeviceStateErrorIfFailed(
        [&]() -> HRESULT
        {
            if (
                !m_AudioClient
            )
            {
                return E_POINTER;
            }


            /*
             * Reinicializa toda a
             * estrutura do formato.
             */

            m_CaptureFormat =
                {};


            m_CaptureFormat.wFormatTag =
                WAVE_FORMAT_PCM;


            m_CaptureFormat.nChannels =
                2;


            m_CaptureFormat.nSamplesPerSec =
                44100;


            m_CaptureFormat.wBitsPerSample =
                16;


            m_CaptureFormat.nBlockAlign =
                m_CaptureFormat.nChannels *
                m_CaptureFormat.wBitsPerSample /
                BITS_PER_BYTE;


            m_CaptureFormat.nAvgBytesPerSec =
                m_CaptureFormat.nSamplesPerSec *
                m_CaptureFormat.nBlockAlign;


            m_CaptureFormat.cbSize =
                0;


            /*
             * =========================
             * SHARED LOOPBACK
             * =========================
             *
             * AUTOCONVERTPCM permite que
             * o Windows converta o formato
             * real do dispositivo para
             * nosso PCM 44.1 kHz.
             */

            const DWORD streamFlags =
                AUDCLNT_STREAMFLAGS_LOOPBACK |
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;


            RETURN_IF_FAILED(
                m_AudioClient
                    ->Initialize(
                        AUDCLNT_SHAREMODE_SHARED,
                        streamFlags,
                        0,
                        0,
                        &m_CaptureFormat,
                        nullptr
                    )
            );


            RETURN_IF_FAILED(
                m_AudioClient
                    ->GetBufferSize(
                        &m_BufferFrames
                    )
            );


            RETURN_IF_FAILED(
                m_AudioClient
                    ->GetService(
                        IID_PPV_ARGS(
                            &m_AudioCaptureClient
                        )
                    )
            );


            RETURN_IF_FAILED(
                MFCreateAsyncResult(
                    nullptr,
                    &m_xSampleReady,
                    nullptr,
                    &m_SampleReadyAsyncResult
                )
            );


            RETURN_IF_FAILED(
                m_AudioClient
                    ->SetEventHandle(
                        m_SampleReadyEvent
                            .get()
                    )
            );


            m_DeviceState =
                DeviceState::Initialized;


            return S_OK;
        }()
    );
}


/*
 * =========================
 * PROCESS LOOPBACK
 * =========================
 *
 * Mantemos exatamente o mecanismo
 * já utilizado para capturar uma
 * aplicação específica.
 */

HRESULT CLoopbackCapture::ActivateAudioInterface(
    DWORD processId,
    bool includeProcessTree
)
{
    return SetDeviceStateErrorIfFailed(
        [&]() -> HRESULT
        {
            if (
                processId ==
                0
            )
            {
                return E_INVALIDARG;
            }


            AUDIOCLIENT_ACTIVATION_PARAMS
                activationParams =
                {};


            activationParams.ActivationType =
                AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;


            activationParams
                .ProcessLoopbackParams
                .ProcessLoopbackMode =
                includeProcessTree
                    ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                    : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;


            activationParams
                .ProcessLoopbackParams
                .TargetProcessId =
                processId;


            PROPVARIANT
                activateParams =
                {};


            activateParams.vt =
                VT_BLOB;


            activateParams.blob.cbSize =
                sizeof(
                    activationParams
                );


            activateParams.blob.pBlobData =
                reinterpret_cast<BYTE*>(
                    &activationParams
                );


            wil::com_ptr_nothrow<
                IActivateAudioInterfaceAsyncOperation
            >
                asyncOp;


            /*
             * O callback ActivateCompleted
             * colocará o IAudioClient em
             * m_AudioClient.
             */

            m_activateResult =
                E_UNEXPECTED;


            RETURN_IF_FAILED(
                ActivateAudioInterfaceAsync(
                    VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                    __uuidof(
                        IAudioClient
                    ),
                    &activateParams,
                    this,
                    &asyncOp
                )
            );


            /*
             * Aguarda ActivateCompleted().
             */

            m_hActivateCompleted.wait();


            return m_activateResult;
        }()
    );
}


/*
 * =========================
 * PROCESS ACTIVATION COMPLETE
 * =========================
 */

HRESULT CLoopbackCapture::ActivateCompleted(
    IActivateAudioInterfaceAsyncOperation*
        operation
)
{
    m_activateResult =
        SetDeviceStateErrorIfFailed(
            [&]() -> HRESULT
            {
                if (!operation)
                {
                    return E_POINTER;
                }


                HRESULT
                    hrActivateResult =
                    E_UNEXPECTED;


                wil::com_ptr_nothrow<
                    IUnknown
                >
                    unknownAudioInterface;


                RETURN_IF_FAILED(
                    operation
                        ->GetActivateResult(
                            &hrActivateResult,
                            &unknownAudioInterface
                        )
                );


                RETURN_IF_FAILED(
                    hrActivateResult
                );


                RETURN_IF_FAILED(
                    unknownAudioInterface
                        .copy_to(
                            &m_AudioClient
                        )
                );


                /*
                 * A partir daqui o caminho
                 * é compartilhado com a
                 * captura do sistema.
                 */

                RETURN_IF_FAILED(
                    ConfigureAudioClient()
                );


                return S_OK;
            }()
        );


    /*
     * Mesmo em erro precisamos liberar
     * quem está aguardando em
     * ActivateAudioInterface().
     */

    m_hActivateCompleted
        .SetEvent();


    return S_OK;
}


/*
 * =========================
 * SYSTEM LOOPBACK
 * =========================
 *
 * Captura a saída do dispositivo
 * de reprodução padrão do Windows.
 *
 * Diferente de PROCESS_LOOPBACK,
 * aqui utilizamos o endpoint físico
 * de renderização.
 */

HRESULT CLoopbackCapture::ActivateSystemAudioInterface()
{
    return SetDeviceStateErrorIfFailed(
        [&]() -> HRESULT
        {
            wil::com_ptr_nothrow<
                IMMDeviceEnumerator
            >
                deviceEnumerator;


            /*
             * Cria o enumerador de
             * dispositivos Core Audio.
             *
             * IMPORTANTE:
             * o processo precisa ter COM
             * inicializado. Faremos isso
             * no ApplicationLoopback.cpp
             * no próximo passo.
             */

            RETURN_IF_FAILED(
                CoCreateInstance(
                    __uuidof(
                        MMDeviceEnumerator
                    ),
                    nullptr,
                    CLSCTX_ALL,
                    __uuidof(
                        IMMDeviceEnumerator
                    ),
                    reinterpret_cast<void**>(
                        deviceEnumerator.put()
                    )
                )
            );


            wil::com_ptr_nothrow<
                IMMDevice
            >
                renderDevice;


            /*
             * Dispositivo padrão usado
             * para reprodução multimídia.
             *
             * É normalmente o mesmo
             * dispositivo em que jogos,
             * navegador, Spotify etc.
             * estão reproduzindo.
             */

            RETURN_IF_FAILED(
                deviceEnumerator
                    ->GetDefaultAudioEndpoint(
                        eRender,
                        eMultimedia,
                        &renderDevice
                    )
            );


            /*
             * Ativação síncrona normal
             * do IAudioClient no endpoint.
             */

            RETURN_IF_FAILED(
                renderDevice
                    ->Activate(
                        __uuidof(
                            IAudioClient
                        ),
                        CLSCTX_ALL,
                        nullptr,
                        reinterpret_cast<void**>(
                            m_AudioClient.put()
                        )
                    )
            );


            /*
             * Daqui em diante usamos
             * exatamente o mesmo pipeline
             * PCM do modo por processo.
             */

            RETURN_IF_FAILED(
                ConfigureAudioClient()
            );


            return S_OK;
        }()
    );
}


/*
 * =========================
 * AGENDAR INÍCIO
 * =========================
 */

HRESULT CLoopbackCapture::QueueStartCapture()
{
    if (
        m_DeviceState !=
        DeviceState::Initialized
    )
    {
        return E_NOT_VALID_STATE;
    }


    m_DeviceState =
        DeviceState::Starting;


    return SetDeviceStateErrorIfFailed(
        MFPutWorkItem2(
            MFASYNC_CALLBACK_QUEUE_MULTITHREADED,
            0,
            &m_xStartCapture,
            nullptr
        )
    );
}


/*
 * =========================
 * INICIAR PROCESS CAPTURE
 * =========================
 */

HRESULT CLoopbackCapture::StartCaptureAsync(
    DWORD processId,
    bool includeProcessTree,
    PCWSTR outputFileName
)
{
    if (
        processId ==
        0
    )
    {
        return E_INVALIDARG;
    }


    /*
     * Mantido para compatibilidade
     * com o sample original.
     */

    m_outputFileName =
        outputFileName;


    auto resetOutputFileName =
        wil::scope_exit(
            [&]
            {
                m_outputFileName =
                    nullptr;
            }
        );


    RETURN_IF_FAILED(
        InitializeLoopbackCapture()
    );


    RETURN_IF_FAILED(
        ActivateAudioInterface(
            processId,
            includeProcessTree
        )
    );


    RETURN_IF_FAILED(
        QueueStartCapture()
    );


    return S_OK;
}


/*
 * =========================
 * INICIAR SYSTEM CAPTURE
 * =========================
 */

HRESULT CLoopbackCapture::StartSystemCaptureAsync(
    PCWSTR outputFileName
)
{
    /*
     * Mantemos a mesma assinatura
     * conceitual para não criar um
     * segundo pipeline de saída.
     */

    m_outputFileName =
        outputFileName;


    auto resetOutputFileName =
        wil::scope_exit(
            [&]
            {
                m_outputFileName =
                    nullptr;
            }
        );


    RETURN_IF_FAILED(
        InitializeLoopbackCapture()
    );


    RETURN_IF_FAILED(
        ActivateSystemAudioInterface()
    );


    RETURN_IF_FAILED(
        QueueStartCapture()
    );


    return S_OK;
}


/*
 * =========================
 * WAV LEGADO
 * =========================
 *
 * Não gravamos mais WAV.
 */

HRESULT CLoopbackCapture::CreateWAVFile()
{
    return S_OK;
}


HRESULT CLoopbackCapture::FixWAVHeader()
{
    return S_OK;
}


/*
 * =========================
 * START
 * =========================
 */

HRESULT CLoopbackCapture::OnStartCapture(
    IMFAsyncResult*
)
{
    return SetDeviceStateErrorIfFailed(
        [&]() -> HRESULT
        {
            if (
                !m_AudioClient
            )
            {
                return E_POINTER;
            }


            RETURN_IF_FAILED(
                m_AudioClient
                    ->Start()
            );


            m_DeviceState =
                DeviceState::Capturing;


            /*
             * Espera o primeiro evento
             * de áudio do WASAPI.
             */

            RETURN_IF_FAILED(
                MFPutWaitingWorkItem(
                    m_SampleReadyEvent
                        .get(),
                    0,
                    m_SampleReadyAsyncResult
                        .get(),
                    &m_SampleReadyKey
                )
            );


            return S_OK;
        }()
    );
}


/*
 * =========================
 * PARAR CAPTURA
 * =========================
 */

HRESULT CLoopbackCapture::StopCaptureAsync()
{
    RETURN_HR_IF(
        E_NOT_VALID_STATE,
        (
            m_DeviceState !=
            DeviceState::Capturing
        ) &&
        (
            m_DeviceState !=
            DeviceState::Error
        )
    );


    m_DeviceState =
        DeviceState::Stopping;


    RETURN_IF_FAILED(
        MFPutWorkItem2(
            MFASYNC_CALLBACK_QUEUE_MULTITHREADED,
            0,
            &m_xStopCapture,
            nullptr
        )
    );


    /*
     * Espera o cleanup terminar.
     */

    m_hCaptureStopped.wait();


    return S_OK;
}


/*
 * =========================
 * ON STOP
 * =========================
 */

HRESULT CLoopbackCapture::OnStopCapture(
    IMFAsyncResult*
)
{
    if (
        m_SampleReadyKey !=
        0
    )
    {
        MFCancelWorkItem(
            m_SampleReadyKey
        );


        m_SampleReadyKey =
            0;
    }


    if (
        m_AudioClient
    )
    {
        /*
         * Se já estiver parado,
         * ignoramos o HRESULT.
         */

        m_AudioClient
            ->Stop();
    }


    m_SampleReadyAsyncResult
        .reset();


    return FinishCaptureAsync();
}


/*
 * =========================
 * FINALIZAR
 * =========================
 */

HRESULT CLoopbackCapture::FinishCaptureAsync()
{
    return MFPutWorkItem2(
        MFASYNC_CALLBACK_QUEUE_MULTITHREADED,
        0,
        &m_xFinishCapture,
        nullptr
    );
}


/*
 * =========================
 * ON FINISH
 * =========================
 */

HRESULT CLoopbackCapture::OnFinishCapture(
    IMFAsyncResult*
)
{
    m_DeviceState =
        DeviceState::Stopped;


    m_hCaptureStopped
        .SetEvent();


    return S_OK;
}


/*
 * =========================
 * SAMPLE READY
 * =========================
 */

HRESULT CLoopbackCapture::OnSampleReady(
    IMFAsyncResult*
)
{
    const HRESULT hr =
        OnAudioSampleRequested();


    if (
        FAILED(
            hr
        )
    )
    {
        m_DeviceState =
            DeviceState::Error;


        return hr;
    }


    if (
        m_DeviceState ==
        DeviceState::Capturing
    )
    {
        return SetDeviceStateErrorIfFailed(
            MFPutWaitingWorkItem(
                m_SampleReadyEvent
                    .get(),
                0,
                m_SampleReadyAsyncResult
                    .get(),
                &m_SampleReadyKey
            )
        );
    }


    return S_OK;
}


/*
 * =========================
 * RECEBER PCM DO WASAPI
 * =========================
 */

HRESULT CLoopbackCapture::OnAudioSampleRequested()
{
    UINT32 framesAvailable =
        0;


    BYTE* data =
        nullptr;


    DWORD captureFlags =
        0;


    UINT64 devicePosition =
        0;


    UINT64 qpcPosition =
        0;


    auto lock =
        m_CritSec.lock();


    /*
     * Não buscamos novos pacotes
     * enquanto estamos encerrando.
     */

    if (
        m_DeviceState ==
        DeviceState::Stopping
    )
    {
        return S_OK;
    }


    /*
     * Processa todos os pacotes
     * atualmente disponíveis.
     */

    while (true)
    {
        framesAvailable =
            0;


        RETURN_IF_FAILED(
            m_AudioCaptureClient
                ->GetNextPacketSize(
                    &framesAvailable
                )
        );


        if (
            framesAvailable ==
            0
        )
        {
            break;
        }


        data =
            nullptr;


        captureFlags =
            0;


        devicePosition =
            0;


        qpcPosition =
            0;


        RETURN_IF_FAILED(
            m_AudioCaptureClient
                ->GetBuffer(
                    &data,
                    &framesAvailable,
                    &captureFlags,
                    &devicePosition,
                    &qpcPosition
                )
        );


        /*
         * Calculamos o tamanho depois
         * do GetBuffer, usando a quantidade
         * real de frames retornada.
         */

        const DWORD bytesToCapture =
            framesAvailable *
            m_CaptureFormat
                .nBlockAlign;


        HRESULT writeResult =
            S_OK;


        /*
         * =========================
         * PCM → STDOUT
         * =========================
         */

        if (
            m_DeviceState !=
            DeviceState::Stopping &&
            bytesToCapture >
            0
        )
        {
            /*
             * Pacote de silêncio.
             *
             * Neste caso Data pode
             * não apontar para PCM válido.
             */

            if (
                captureFlags &
                AUDCLNT_BUFFERFLAGS_SILENT
            )
            {
                std::vector<BYTE>
                    silence(
                        bytesToCapture,
                        0
                    );


                const size_t written =
                    fwrite(
                        silence.data(),
                        1,
                        bytesToCapture,
                        stdout
                    );


                if (
                    written !=
                    bytesToCapture
                )
                {
                    writeResult =
                        E_FAIL;
                }
            }
            else
            {
                if (!data)
                {
                    writeResult =
                        E_POINTER;
                }
                else
                {
                    const size_t written =
                        fwrite(
                            data,
                            1,
                            bytesToCapture,
                            stdout
                        );


                    if (
                        written !=
                        bytesToCapture
                    )
                    {
                        writeResult =
                            E_FAIL;
                    }
                }
            }
        }


        /*
         * O buffer SEMPRE deve ser
         * devolvido ao WASAPI antes
         * de sair desta iteração.
         */

        const HRESULT releaseResult =
            m_AudioCaptureClient
                ->ReleaseBuffer(
                    framesAvailable
                );


        RETURN_IF_FAILED(
            releaseResult
        );


        RETURN_IF_FAILED(
            writeResult
        );
    }


    return S_OK;
}