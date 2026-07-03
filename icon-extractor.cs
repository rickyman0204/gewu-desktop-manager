using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public class IconExtractor
{
    [ComImport]
    [Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem
    {
        [PreserveSig] int BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        [PreserveSig] int GetParent(out IShellItem ppsi);
        [PreserveSig] int GetDisplayName(uint sigdnName, out IntPtr ppszName);
        [PreserveSig] int GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        [PreserveSig] int Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport]
    [Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory
    {
        [PreserveSig] int GetImage(ref SIZE size, uint flags, out IntPtr phbm);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SIZE { public int cx, cy; }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(
        [In] string pszPath, [In] IntPtr pbc, [In] ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out object ppv);

    [DllImport("gdi32.dll")]
    static extern bool DeleteObject(IntPtr hObject);

    const uint SIIGBF_ICONONLY = 0x00000004;
    const uint SIIGBF_BIGGERSIZEOK = 0x00000001;
    const uint SIIGBF_SCALEUP = 0x00000010;

    static Bitmap ExtractShellBitmap(string path, int size)
    {
        try
        {
            Guid iid = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");
            object obj;
            SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out obj);
            var factory = (IShellItemImageFactory)obj;

            SIZE sz;
            sz.cx = size;
            sz.cy = size;

            IntPtr hBitmap;
            int hr = factory.GetImage(ref sz, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK | SIIGBF_SCALEUP, out hBitmap);

            if (hr != 0 || hBitmap == IntPtr.Zero) return null;

            try
            {
                return new Bitmap(Image.FromHbitmap(hBitmap));
            }
            finally { DeleteObject(hBitmap); }
        }
        catch { return null; }
    }

    static Bitmap ExtractViaIcon(string path)
    {
        try
        {
            using (var icon = Icon.ExtractAssociatedIcon(path))
            {
                if (icon == null) return null;
                return icon.ToBitmap();
            }
        }
        catch { return null; }
    }

    static string RenderPng(Bitmap source, int targetSize)
    {
        using (var output = new Bitmap(targetSize, targetSize, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(output))
            {
                g.Clear(Color.Transparent);
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                g.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighQuality;
                g.DrawImage(source, 0, 0, targetSize, targetSize);
            }
            using (var ms = new MemoryStream())
            {
                output.Save(ms, ImageFormat.Png);
                return Convert.ToBase64String(ms.ToArray());
            }
        }
    }

    static string ExtractSize(string path, int requestSize, int renderSize)
    {
        Bitmap shell = ExtractShellBitmap(path, requestSize);
        if (shell != null)
        {
            try
            {
                if (shell.Width == renderSize && shell.Height == renderSize)
                {
                    using (var ms = new MemoryStream())
                    {
                        shell.Save(ms, ImageFormat.Png);
                        return Convert.ToBase64String(ms.ToArray());
                    }
                }
                return RenderPng(shell, renderSize);
            }
            finally { shell.Dispose(); }
        }

        Bitmap icon = ExtractViaIcon(path);
        if (icon != null)
        {
            try { return RenderPng(icon, renderSize); }
            finally { icon.Dispose(); }
        }

        return null;
    }

    static void Main(string[] args)
    {
        if (args.Length < 1) return;
        string filePath = args[0];

        int[][] specs = {
            new int[] { 1024, 96 },
            new int[] { 1024, 288 },
            new int[] { 2048, 1024 }
        };

        string[] parts = new string[specs.Length];
        for (int i = 0; i < specs.Length; i++)
        {
            int reqSize = specs[i][0];
            int renderSize = specs[i][1];
            string b64 = ExtractSize(filePath, reqSize, renderSize);
            if (b64 == null) return;
            parts[i] = Convert.ToBase64String(
                System.Text.Encoding.UTF8.GetBytes(renderSize + ":" + b64));
        }
        Console.Write(string.Join("|", parts));
    }
}
