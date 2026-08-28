# ============================================================
#  记忆点 App — 手工构建 APK 脚本（v2）
#  无需 gradle/Android Studio，直接用 SDK 工具链构建
#  用法:  powershell -ExecutionPolicy Bypass -File 构建APK.ps1
#  说明: aapt2 不加 -A 打包 assets（Windows 下会用反斜杠，
#        导致 Android 找不到资源）；assets 改用 jar 添加（正斜杠）
# ============================================================
param(
    [int]$VersionCode = 94,
    [string]$VersionName = "9.4.0"
)

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Proj = Join-Path $Root "Android源码"
$Build = Join-Path $Root "_build_apk"
$Sdk = "C:\Users\张伟\AppData\Local\Android\Sdk"
$Bt  = Join-Path $Sdk "build-tools\37.0.0"
$Jdk = "C:\Users\张伟\.vscode\extensions\redhat.java-1.55.0-win32-x64\jre\21.0.11-win32-x86_64"
$Keystore = Join-Path $Proj "debug.keystore"
$OutApk = Join-Path $Root "记忆点-debug.apk"

$java  = Join-Path $Jdk "bin\java.exe"
$javac = Join-Path $Jdk "bin\javac.exe"
$jar   = Join-Path $Jdk "bin\jar.exe"
$keytool = Join-Path $Jdk "bin\keytool.exe"
$env:JAVA_HOME = $Jdk

function Check($code, $msg) { if ($code -ne 0) { throw $msg } }

Write-Host "==> 0. 准备构建目录"
if (Test-Path $Build) { Remove-Item $Build -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $Build "res"),(Join-Path $Build "assets"),(Join-Path $Build "gen"),(Join-Path $Build "classes"),(Join-Path $Build "dex") | Out-Null
Copy-Item (Join-Path $Proj "app\src\main\res\*") (Join-Path $Build "res\") -Recurse -Force
Copy-Item (Join-Path $Proj "app\src\main\assets\*") (Join-Path $Build "assets\") -Recurse -Force
Copy-Item (Join-Path $Proj "app\src\main\AndroidManifest.xml") (Join-Path $Build "AndroidManifest.xml") -Force

Write-Host "==> 1. 注入 package + 版本号 + uses-sdk"
$mf = Join-Path $Build "AndroidManifest.xml"
$xml = [System.IO.File]::ReadAllText($mf, [System.Text.Encoding]::UTF8)
if ($xml -notmatch 'package=') {
    $attr = '<manifest package="com.dailyplanner.app" android:versionCode="' + $VersionCode + '" android:versionName="' + $VersionName + '" '
    $xml = $xml -replace '<manifest ', $attr
} else {
    $xml = $xml -replace 'android:versionCode="[^"]*"', ('android:versionCode="' + $VersionCode + '"')
    $xml = $xml -replace 'android:versionName="[^"]*"', ('android:versionName="' + $VersionName + '"')
}
if ($xml -notmatch 'uses-sdk') {
    $usesSdk = '<uses-sdk android:minSdkVersion="26" android:targetSdkVersion="36"/>'
    $xml = $xml -replace '<application', ($usesSdk + '<application')
}
[System.IO.File]::WriteAllText($mf, $xml, (New-Object System.Text.UTF8Encoding $false))
Write-Host "    versionCode=$VersionCode versionName=$VersionName minSdk=26 targetSdk=36"

Push-Location $Build
try {
    Write-Host "==> 2. aapt2 compile 资源"
    & (Join-Path $Bt "aapt2.exe") compile --dir res -o compiled.zip 2>&1 | Out-Null
    Check $LASTEXITCODE "aapt2 compile 失败"

    Write-Host "==> 3. aapt2 link（资源，不含 assets）"
    & (Join-Path $Bt "aapt2.exe") link -o base.apk -I (Join-Path $Sdk "platforms\android-36\android.jar") --manifest AndroidManifest.xml --java gen compiled.zip 2>&1 | Out-Null
    Check $LASTEXITCODE "aapt2 link 失败"

    Write-Host "==> 4. javac 编译（R.java + MainActivity）"
    $javaSrc = Join-Path $Proj "app\src\main\java\com\dailyplanner\app\MainActivity.java"
    & $javac --release 17 -encoding UTF-8 -cp (Join-Path $Sdk "platforms\android-36\android.jar") -d classes "gen\com\dailyplanner\app\R.java" $javaSrc 2>&1 | Out-Null
    Check $LASTEXITCODE "javac 失败"

    Write-Host "==> 5. d8 转 dex"
    $classList = Get-ChildItem classes -Recurse -Filter "*.class" | ForEach-Object { $_.FullName }
    & (Join-Path $Bt "d8.bat") --release --lib (Join-Path $Sdk "platforms\android-36\android.jar") --output dex $classList 2>&1 | Out-Null
    Check $LASTEXITCODE "d8 失败"

    Write-Host "==> 6. jar 添加 classes.dex（正斜杠）"
    & $jar uf base.apk -C dex classes.dex 2>&1 | Out-Null
    Check $LASTEXITCODE "添加 dex 失败"

    Write-Host "==> 7. jar 添加 assets/www（正斜杠，保持 arsc 未压缩）"
        # 注意：Android 的 assets 在 APK 中必须有 "assets/" 前缀
    # 当前目录已是 $Build，相对路径 assets 会正确生成 assets/www/...
    & $jar uf base.apk assets 2>&1 | Out-Null
    Check $LASTEXITCODE "添加 assets 失败"

    Write-Host "==> 8. zipalign"
    & (Join-Path $Bt "zipalign.exe") -f 4 base.apk aligned.apk 2>&1 | Out-Null
    Check $LASTEXITCODE "zipalign 失败"

    Write-Host "==> 9. 签名（debug.keystore）"
    if (-not (Test-Path $Keystore)) {
        & $keytool -genkeypair -keystore $Keystore -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US" 2>&1 | Out-Null
    }
    & (Join-Path $Bt "apksigner.bat") sign --ks $Keystore --ks-pass pass:android --key-pass pass:android --out (Join-Path $Build "signed.apk") aligned.apk 2>&1 | Out-Null
    Check $LASTEXITCODE "签名失败"

    Write-Host "==> 10. 验证签名"
    & (Join-Path $Bt "apksigner.bat") verify (Join-Path $Build "signed.apk") 2>&1 | Out-Null
    Check $LASTEXITCODE "签名验证失败"

    Copy-Item (Join-Path $Build "signed.apk") $OutApk -Force
    Write-Host ""
    Write-Host "=============================================="
    Write-Host "  构建成功！APK: $OutApk"
    Write-Host "  versionCode=$VersionCode  versionName=$VersionName"
    Write-Host "  大小: $([math]::Round((Get-Item $OutApk).Length/1MB,2)) MB"
    Write-Host "=============================================="
} finally {
    Pop-Location
}