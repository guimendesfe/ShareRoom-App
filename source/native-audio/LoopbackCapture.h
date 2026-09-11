#pragma once

#include <AudioClient.h>
#include <mmdeviceapi.h>
#include <initguid.h>
#include <guiddef.h>
#include <mfapi.h>

#include <wrl\implements.h>
#include <wil\com.h>
#include <wil\result.h>

#include "Common.h"


using namespace Microsoft::WRL;


class CLoopbackCapture :
    public RuntimeClass<
        RuntimeClassFlags<ClassicCom>,
        FtmBase,
        IActivateAudioInterfaceCompletionHandler
    >
{
public:
    CLoopbackCapture() = default;

    ~CLoopbackCapture();


    /*
     * =========================
     * PROCESS LOOPBACK
     * =========================
     *
     * Captura somente o áudio
     * produzido por um processo
     * e, opcionalmente, seus filhos.
     *
     * É o modo que já utilizamos
     * para compartilhar uma janela.
     */

    HRESULT StartCaptureAsync(
        DWORD processId,
        bool includeProcessTree,
        PCWSTR outputFileName
    );


    /*
     * =========================
     * SYSTEM LOOPBACK
     * =========================
     *
     * Captura a mixagem completa
     * reproduzida pelo dispositivo
     * de áudio padrão do Windows.
     *
     * Será usado quando o usuário
     * compartilhar a tela inteira.
     */

    HRESULT StartSystemCaptureAsync(
        PCWSTR outputFileName
    );


    /*
     * =========================
     * PARAR CAPTURA
     * =========================
     */

    HRESULT StopCaptureAsync();


    /*
     * =========================
     * MEDIA FOUNDATION CALLBACKS
     * =========================
     */

    METHODASYNCCALLBACK(
        CLoopbackCapture,
        StartCapture,
        OnStartCapture
    );


    METHODASYNCCALLBACK(
        CLoopbackCapture,
        StopCapture,
        OnStopCapture
    );


    METHODASYNCCALLBACK(
        CLoopbackCapture,
        SampleReady,
        OnSampleReady
    );


    METHODASYNCCALLBACK(
        CLoopbackCapture,
        FinishCapture,
        OnFinishCapture
    );


    /*
     * =========================
     * PROCESS LOOPBACK CALLBACK
     * =========================
     *
     * Usado por
     * ActivateAudioInterfaceAsync.
     */

    STDMETHOD(
        ActivateCompleted
    )(
        IActivateAudioInterfaceAsyncOperation*
            operation
    );


private:
    /*
     * =========================
     * ESTADO
     * =========================
     */

    enum class DeviceState
    {
        Uninitialized,
        Error,
        Initialized,
        Starting,
        Capturing,
        Stopping,
        Stopped,
    };


    /*
     * =========================
     * CALLBACKS INTERNOS
     * =========================
     */

    HRESULT OnStartCapture(
        IMFAsyncResult* pResult
    );


    HRESULT OnStopCapture(
        IMFAsyncResult* pResult
    );


    HRESULT OnFinishCapture(
        IMFAsyncResult* pResult
    );


    HRESULT OnSampleReady(
        IMFAsyncResult* pResult
    );


    /*
     * =========================
     * INICIALIZAÇÃO
     * =========================
     */

    HRESULT InitializeLoopbackCapture();


    /*
     * =========================
     * PROCESS LOOPBACK
     * =========================
     *
     * Mantemos esta função com
     * o mesmo nome para preservar
     * o código já funcional.
     */

    HRESULT ActivateAudioInterface(
        DWORD processId,
        bool includeProcessTree
    );


    /*
     * =========================
     * SYSTEM LOOPBACK
     * =========================
     *
     * Abre o dispositivo de
     * renderização padrão do Windows.
     */

    HRESULT ActivateSystemAudioInterface();


    /*
     * =========================
     * CONFIGURAR AUDIO CLIENT
     * =========================
     *
     * Tanto process loopback quanto
     * system loopback utilizarão
     * exatamente o mesmo formato:
     *
     * PCM
     * 44.1 kHz
     * 16 bits
     * Stereo
     */

    HRESULT ConfigureAudioClient();


    /*
     * =========================
     * START WORK ITEM
     * =========================
     *
     * Centraliza a transição:
     *
     * Initialized
     *      ↓
     * Starting
     *      ↓
     * OnStartCapture
     */

    HRESULT QueueStartCapture();


    /*
     * =========================
     * WAV LEGADO
     * =========================
     *
     * Mantidos temporariamente
     * para preservar a estrutura
     * proveniente do sample.
     *
     * Não gravamos WAV.
     */

    HRESULT CreateWAVFile();

    HRESULT FixWAVHeader();


    /*
     * =========================
     * PCM
     * =========================
     */

    HRESULT OnAudioSampleRequested();


    /*
     * =========================
     * FINALIZAÇÃO
     * =========================
     */

    HRESULT FinishCaptureAsync();


    HRESULT SetDeviceStateErrorIfFailed(
        HRESULT hr
    );


    /*
     * =========================
     * WASAPI
     * =========================
     */

    wil::com_ptr_nothrow<
        IAudioClient
    >
        m_AudioClient;


    WAVEFORMATEX
        m_CaptureFormat{};


    UINT32
        m_BufferFrames =
        0;


    wil::com_ptr_nothrow<
        IAudioCaptureClient
    >
        m_AudioCaptureClient;


    /*
     * =========================
     * MEDIA FOUNDATION
     * =========================
     */

    wil::com_ptr_nothrow<
        IMFAsyncResult
    >
        m_SampleReadyAsyncResult;


    wil::unique_event_nothrow
        m_SampleReadyEvent;


    MFWORKITEM_KEY
        m_SampleReadyKey =
        0;


    /*
     * =========================
     * LEGADO WAV
     * =========================
     */

    wil::unique_hfile
        m_hFile;


    DWORD
        m_cbHeaderSize =
        0;


    DWORD
        m_cbDataSize =
        0;


    PCWSTR
        m_outputFileName =
        nullptr;


    /*
     * =========================
     * SINCRONIZAÇÃO
     * =========================
     */

    wil::critical_section
        m_CritSec;


    DWORD
        m_dwQueueID =
        0;


    /*
     * =========================
     * PROCESS LOOPBACK ASYNC
     * =========================
     */

    HRESULT
        m_activateResult =
        E_UNEXPECTED;


    wil::unique_event_nothrow
        m_hActivateCompleted;


    /*
     * =========================
     * STOP
     * =========================
     */

    wil::unique_event_nothrow
        m_hCaptureStopped;


    DeviceState
        m_DeviceState{
            DeviceState::Uninitialized
        };
};