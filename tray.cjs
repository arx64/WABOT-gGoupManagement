const {
    app,
    Tray,
    Menu,
    shell
} = require("electron");

const {
    spawn,
    execFile
} = require("child_process");

const path = require("path");

const PROJECT_DIR = "D:\\zoom-reminder";
const QR_URL = "http://localhost:2004/qr";
const DASHBOARD_URL = "http://localhost:2004/";

let tray = null;
let serverProcess = null;
let isQuitting = false;


// ============================================================
// SINGLE INSTANCE
// ============================================================

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
}


// ============================================================
// SHOW / HIDE CMD
// ============================================================

function setConsoleVisibility(show) {
    if (!serverProcess || !serverProcess.pid) {
        return;
    }

    const pid = serverProcess.pid;

    const psScript = `
Add-Type @'
using System;
using System.Runtime.InteropServices;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue

if ($p) {
    $hWnd = $p.MainWindowHandle

    if ($hWnd -ne [IntPtr]::Zero) {

        if (${show ? "true" : "false"}) {
            [Win32]::ShowWindow($hWnd, 9)
            [Win32]::SetForegroundWindow($hWnd)
        }
        else {
            [Win32]::ShowWindow($hWnd, 0)
        }
    }
}
`;

    execFile(
        "powershell.exe",
        [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            psScript
        ],
        {
            windowsHide: true
        },
        (error) => {
            if (error) {
                console.error(
                    "Gagal mengubah visibility CMD:",
                    error.message
                );
            }
        }
    );
}


// ============================================================
// HIDE CMD DENGAN RETRY
// ============================================================

function hideConsoleWithRetry(attempt = 0) {
    if (!serverProcess || !serverProcess.pid) {
        return;
    }

    setConsoleVisibility(false);

    if (attempt < 10) {
        setTimeout(() => {
            hideConsoleWithRetry(attempt + 1);
        }, 200);
    }
}


// ============================================================
// START NPM
// ============================================================

function startServer() {
    console.log("Starting Zoom Reminder server...");

    serverProcess = spawn(
        "cmd.exe",
        [
            "/k",
            "title Zoom Reminder Server && npm start"
        ],
        {
            cwd: PROJECT_DIR,

            // CMD harus benar-benar memiliki window
            // agar nanti bisa kita munculkan kembali.
            windowsHide: false,

            detached: false
        }
    );

    serverProcess.on("error", (error) => {
        console.error(
            "Gagal menjalankan npm start:",
            error.message
        );
    });

    serverProcess.on("exit", (code, signal) => {
        console.log(
            `Server berhenti. Code: ${code}, Signal: ${signal}`
        );

        serverProcess = null;

        if (!isQuitting) {
            console.log(
                "Server berhenti tetapi tray masih berjalan."
            );
        }
    });

    // Tunggu CMD selesai dibuat,
    // kemudian sembunyikan CMD tersebut.
    setTimeout(() => {
        hideConsoleWithRetry();
    }, 500);
}


// ============================================================
// STOP SERVER
// ============================================================

function stopServer(callback) {
    if (!serverProcess || !serverProcess.pid) {
        if (callback) callback();
        return;
    }

    const pid = serverProcess.pid;

    console.log(`Stopping server process tree: ${pid}`);

    execFile(
        "taskkill.exe",
        [
            "/PID",
            pid.toString(),
            "/T",
            "/F"
        ],
        {
            windowsHide: true
        },
        (error, stdout, stderr) => {

            if (error) {
                console.error(
                    "Gagal menghentikan server:",
                    error.message
                );
            }

            serverProcess = null;

            if (callback) {
                callback();
            }
        }
    );
}


// ============================================================
// ELECTRON READY
// ============================================================

app.whenReady().then(() => {

    // --------------------------------------------------------
    // START SERVER
    // --------------------------------------------------------

    startServer();


    // --------------------------------------------------------
    // TRAY ICON
    // --------------------------------------------------------

    const iconPath = path.join(
        __dirname,
        "icon.ico"
    );

    tray = new Tray(iconPath);

    tray.setToolTip(
        "Zoom Reminder - Server berjalan"
    );


    // --------------------------------------------------------
    // CONTEXT MENU
    // --------------------------------------------------------

    const contextMenu = Menu.buildFromTemplate([

        // ================================================
        // BUKA QR
        // ================================================

        {
            label: "📷 Buka QR",

            click: () => {
                shell.openExternal(QR_URL);
            }
        },


        // ================================================
        // BUKA DASHBOARD
        // ================================================

        {
            label: "🖥️ Buka Dashboard",

            click: () => {

                // Tampilkan CMD yang SAMA
                // yang menjalankan npm start.
                setConsoleVisibility(true);
            }
        },


        // ================================================
        // SEPARATOR
        // ================================================

        {
            type: "separator"
        },


        // ================================================
        // KELUAR
        // ================================================

        {
            label: "❌ Keluar",

            click: () => {

                if (isQuitting) {
                    return;
                }

                isQuitting = true;

                stopServer(() => {
                    app.quit();
                });
            }
        }
    ]);


    tray.setContextMenu(contextMenu);


    // --------------------------------------------------------
    // DOUBLE CLICK ICON
    // --------------------------------------------------------

    tray.on("double-click", () => {

        // Double click juga menampilkan CMD.
        setConsoleVisibility(true);
    });
});


// ============================================================
// JANGAN BIARKAN ELECTRON KELUAR SENDIRI
// ============================================================

app.on("window-all-closed", (event) => {
    event.preventDefault();
});


// ============================================================
// HANDLE QUIT
// ============================================================

app.on("before-quit", (event) => {

    if (isQuitting) {
        return;
    }

    event.preventDefault();

    isQuitting = true;

    stopServer(() => {
        app.quit();
    });
});