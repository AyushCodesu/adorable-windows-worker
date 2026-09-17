param(
    [Parameter(Mandatory=$true)]
    [int]$ProcessId,
    [Parameter(Mandatory=$true)]
    [string]$OutputPath,
    [int]$TimeoutMs = 10000
)

$csharpCode = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class NativeCapture {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static string CaptureWindow(IntPtr hWnd, string filePath) {
        if (hWnd == IntPtr.Zero) return "ERROR:InvalidWindowHandle";

        RECT rect;
        // DWMWA_EXTENDED_FRAME_BOUNDS = 9
        int hr = DwmGetWindowAttribute(hWnd, 9, out rect, Marshal.SizeOf(typeof(RECT)));
        if (hr != 0 || (rect.Right - rect.Left) <= 0 || (rect.Bottom - rect.Top) <= 0) {
            if (!GetWindowRect(hWnd, out rect)) {
                return "ERROR:GetWindowRectFailed";
            }
        }

        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) {
            return "ERROR:InvalidWindowBounds";
        }

        using (Bitmap bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                IntPtr hdc = g.GetHdc();
                // PW_RENDERFULLCONTENT = 2
                bool pwSuccess = PrintWindow(hWnd, hdc, 2);
                if (!pwSuccess) {
                    pwSuccess = PrintWindow(hWnd, hdc, 0);
                }
                g.ReleaseHdc(hdc);

                if (!pwSuccess) {
                    // Fallback to CopyFromScreen
                    g.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
                }
            }
            bmp.Save(filePath, ImageFormat.Png);
        }

        return "SUCCESS:" + width + ":" + height;
    }
}
"@

try {
    Add-Type -TypeDefinition $csharpCode -ReferencedAssemblies System.Drawing
} catch {
    # Type might already be loaded in session
}

$startTime = [Environment]::TickCount
$hwnd = [IntPtr]::Zero

while (([Environment]::TickCount - $startTime) -lt $TimeoutMs) {
    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction Stop
        if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
            $hwnd = $proc.MainWindowHandle
            break
        }
    } catch {
        Write-Output "ERROR:ProcessExited"
        exit 1
    }
    Start-Sleep -Milliseconds 100
}

if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output "ERROR:WindowTimeout"
    exit 1
}

# Small stabilization delay to ensure window content is painted
Start-Sleep -Milliseconds 350

$result = [NativeCapture]::CaptureWindow($hwnd, $OutputPath)
Write-Output $result
