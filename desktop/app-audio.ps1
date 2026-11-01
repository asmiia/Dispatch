# Captures the sound of one program, and nothing else, with the Windows process loopback API (Windows 10 2004 and
# later). It reads from the audio engine, it does not touch,
# hook or inject into the program. Raw 16-bit 48 kHz stereo samples go to standard output.
#   powershell -File app-audio.ps1 -ProcessId 1234      (or -Hwnd 395842 to find the program from its window)
param([int]$ProcessId = 0, [long]$Hwnd = 0)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class AppAudio
{
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath, ref Guid riid, IntPtr activationParams, IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation { void GetActivateResult([MarshalAs(UnmanagedType.Error)] out int hr, [MarshalAs(UnmanagedType.IUnknown)] out object iface); }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler { void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op); }

    [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, uint flags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint size);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    [ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    class Handler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public IAudioClient Client; public int Result; public ManualResetEvent Done = new ManualResetEvent(false);
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op)
        {
            object o; op.GetActivateResult(out Result, out o); Client = o as IAudioClient; Done.Set();
        }
    }

    [StructLayout(LayoutKind.Sequential)] struct LoopbackParams { public int ActivationType; public uint ProcessId; public int Mode; }
    [StructLayout(LayoutKind.Sequential)] struct PropVariant { public ushort vt; public ushort r1, r2, r3; public uint cbSize; public IntPtr blob; }
    [StructLayout(LayoutKind.Sequential, Pack = 2)] struct WaveFormat { public ushort tag, channels; public uint rate, bytesPerSec; public ushort align, bits, extra; }
    [DllImport("kernel32.dll")] static extern IntPtr CreateEvent(IntPtr a, bool manual, bool initial, string name);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);

    public static uint ProcessOf(long hwnd) { uint pid; GetWindowThreadProcessId(new IntPtr(hwnd), out pid); return pid; }

    public static void Capture(uint pid)
    {
        var p = new LoopbackParams { ActivationType = 1, ProcessId = pid, Mode = 0 };
        IntPtr pp = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(LoopbackParams))); Marshal.StructureToPtr(p, pp, false);
        var pv = new PropVariant { vt = 65, cbSize = (uint)Marshal.SizeOf(typeof(LoopbackParams)), blob = pp };
        IntPtr pvp = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(PropVariant))); Marshal.StructureToPtr(pv, pvp, false);
        var h = new Handler(); IActivateAudioInterfaceAsyncOperation op;
        Guid iid = typeof(IAudioClient).GUID;
        ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, pvp, h, out op);
        if (!h.Done.WaitOne(8000) || h.Result != 0 || h.Client == null) throw new Exception("Could not capture that program's sound (code " + h.Result + ").");
        var wf = new WaveFormat { tag = 1, channels = 2, rate = 48000, bits = 16, align = 4, bytesPerSec = 48000 * 4, extra = 0 };
        IntPtr wfp = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WaveFormat))); Marshal.StructureToPtr(wf, wfp, false);
        // loopback | event callback | convert to this format
        int hr = h.Client.Initialize(0, 0x00020000u | 0x00040000u | 0x80000000u | 0x08000000u, 2000000, 0, wfp, IntPtr.Zero);
        if (hr != 0) throw new Exception("Audio setup failed (0x" + hr.ToString("X") + ").");
        IntPtr ev = CreateEvent(IntPtr.Zero, false, false, null);
        h.Client.SetEventHandle(ev);
        Guid cid = typeof(IAudioCaptureClient).GUID; object svc;
        h.Client.GetService(ref cid, out svc);
        var cap = (IAudioCaptureClient)svc;
        h.Client.Start();
        var stdout = Console.OpenStandardOutput(); byte[] buf = new byte[0];
        while (true)
        {
            WaitForSingleObject(ev, 200);
            uint frames;
            while (cap.GetNextPacketSize(out frames) == 0 && frames > 0)
            {
                IntPtr data; uint fr, flags; ulong a, b;
                if (cap.GetBuffer(out data, out fr, out flags, out a, out b) != 0) break;
                int n = (int)fr * 4;
                if (buf.Length < n) buf = new byte[n];
                if ((flags & 2) != 0) Array.Clear(buf, 0, n); else Marshal.Copy(data, buf, 0, n);
                cap.ReleaseBuffer(fr);
                stdout.Write(buf, 0, n); stdout.Flush();
            }
        }
    }
}
"@
if ($ProcessId -eq 0 -and $Hwnd -ne 0) { $ProcessId = [AppAudio]::ProcessOf($Hwnd) }
if ($ProcessId -eq 0) { [Console]::Error.WriteLine("No program found."); exit 2 }
try { [AppAudio]::Capture([uint32]$ProcessId) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 3 }
