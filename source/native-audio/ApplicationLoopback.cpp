#include <Windows.h>

#include <fcntl.h>
#include <io.h>

#include <iostream>
#include <string>

#include "LoopbackCapture.h"


void usage()
{
    std::wcerr
        << L"ShareRoom Audio Helper\n"
        << L"\n"
        << L"Usage:\n"
        << L"  ApplicationLoopback <pid> [seconds]\n"
        << L"  ApplicationLoopback --system [seconds]\n"
        << L"\n"
        << L"Examples:\n"
        << L"  ApplicationLoopback 1234\n"
        << L"  ApplicationLoopback 1234 5\n"
        << L"  ApplicationLoopback --system\n"
        << L"  ApplicationLoopback --system 5\n";
}


int wmain(
    int argc,
    wchar_t* argv[]
)
{
    /*
     * =========================
     * ARGUMENTOS
     * =========================
     */

    if (
        argc < 2 ||
        argc > 3
    )
    {
        usage();

        return 1;
    }


    const std::wstring modeArgument =
        argv[1];


    const bool systemMode =
        modeArgument ==
        L"--system";


    DWORD processId =
        0;


    /*
     * =========================
     * PID
     * =========================
     *
     * Somente é necessário
     * no modo por processo.
     */

    if (!systemMode)
    {
        wchar_t* endPointer =
            nullptr;


        const unsigned long parsedPid =
            wcstoul(
                argv[1],
                &endPointer,
                10
            );


        if (
            parsedPid == 0 ||
            endPointer == argv[1] ||
            *endPointer != L'\0'
        )
        {
            usage();

            return 1;
        }


        processId =
            static_cast<DWORD>(
                parsedPid
            );
    }


    /*
     * =========================
     * TEMPO OPCIONAL
     * =========================
     *
     * Usado somente para testes.
     *
     * Exemplo:
     *
     * --system 5
     *
     * captura durante 5 segundos.
     */

    int captureSeconds =
        0;


    if (
        argc ==
        3
    )
    {
        wchar_t* endPointer =
            nullptr;


        const long parsedSeconds =
            wcstol(
                argv[2],
                &endPointer,
                10
            );


        if (
            parsedSeconds <= 0 ||
            parsedSeconds > 86400 ||
            endPointer == argv[2] ||
            *endPointer != L'\0'
        )
        {
            usage();

            return 1;
        }


        captureSeconds =
            static_cast<int>(
                parsedSeconds
            );
    }


    /*
     * =========================
     * COM
     * =========================
     *
     * Necessário para:
     *
     * IMMDeviceEnumerator
     * WASAPI
     * ActivateAudioInterfaceAsync
     */

    const HRESULT comResult =
        CoInitializeEx(
            nullptr,
            COINIT_MULTITHREADED
        );


    if (
        FAILED(comResult) &&
        comResult != RPC_E_CHANGED_MODE
    )
    {
        std::wcerr
            << L"ERROR: Não foi possível inicializar COM. HRESULT=0x"
            << std::hex
            << static_cast<unsigned long>(
                comResult
            )
            << std::endl;


        return 1;
    }


    const bool shouldUninitializeCom =
        SUCCEEDED(
            comResult
        );


    /*
     * =========================
     * STDOUT BINÁRIO
     * =========================
     *
     * stdout:
     * PCM puro
     *
     * stderr:
     * mensagens/logs
     */

    if (
        _setmode(
            _fileno(stdout),
            _O_BINARY
        ) ==
        -1
    )
    {
        std::wcerr
            << L"ERROR: Não foi possível configurar stdout em modo binário."
            << std::endl;


        if (
            shouldUninitializeCom
        )
        {
            CoUninitialize();
        }


        return 1;
    }


    /*
     * Sem buffering adicional.
     *
     * O Electron deve receber
     * o PCM assim que ele sair
     * do WASAPI.
     */

    setvbuf(
        stdout,
        nullptr,
        _IONBF,
        0
    );


    /*
     * =========================
     * CAPTURA
     * =========================
     */

    CLoopbackCapture capture;


    HRESULT captureResult =
        E_FAIL;


    if (
        systemMode
    )
    {
        /*
         * =========================
         * SYSTEM LOOPBACK
         * =========================
         *
         * Captura todo o áudio
         * reproduzido pelo dispositivo
         * padrão do Windows.
         */

        captureResult =
            capture.StartSystemCaptureAsync(
                L""
            );
    }
    else
    {
        /*
         * =========================
         * PROCESS LOOPBACK
         * =========================
         *
         * Captura somente o processo
         * selecionado e seus filhos.
         */

        captureResult =
            capture.StartCaptureAsync(
                processId,
                true,
                L""
            );
    }


    /*
     * =========================
     * FALHA AO INICIAR
     * =========================
     */

    if (
        FAILED(
            captureResult
        )
    )
    {
        std::wcerr
            << L"ERROR: Não foi possível iniciar a captura. HRESULT=0x"
            << std::hex
            << static_cast<unsigned long>(
                captureResult
            )
            << std::endl;


        if (
            shouldUninitializeCom
        )
        {
            CoUninitialize();
        }


        return 1;
    }


    /*
     * =========================
     * READY
     * =========================
     */

    if (
        systemMode
    )
    {
        std::wcerr
            << L"READY SYSTEM"
            << std::endl;
    }
    else
    {
        std::wcerr
            << L"READY PID="
            << processId
            << std::endl;
    }


    /*
     * =========================
     * MODO TEMPORIZADO
     * =========================
     */

    if (
        captureSeconds >
        0
    )
    {
        Sleep(
            static_cast<DWORD>(
                captureSeconds
            ) *
            1000
        );
    }
    else
    {
        /*
         * =========================
         * MODO CONTÍNUO
         * =========================
         *
         * O Electron mantém o helper
         * aberto.
         *
         * Para encerrar envia:
         *
         * stop
         */

        std::string command;


        while (
            std::getline(
                std::cin,
                command
            )
        )
        {
            if (
                command ==
                "stop"
            )
            {
                break;
            }
        }
    }


    /*
     * =========================
     * PARAR CAPTURA
     * =========================
     */

    const HRESULT stopResult =
        capture.StopCaptureAsync();


    if (
        FAILED(
            stopResult
        )
    )
    {
        std::wcerr
            << L"WARNING: A captura terminou com HRESULT=0x"
            << std::hex
            << static_cast<unsigned long>(
                stopResult
            )
            << std::endl;
    }


    std::wcerr
        << L"STOPPED"
        << std::endl;


    /*
     * =========================
     * COM CLEANUP
     * =========================
     */

    if (
        shouldUninitializeCom
    )
    {
        CoUninitialize();
    }


    return 0;
}