; Saved as UTF-8 with BOM; Inno Setup 6.7.3. Installation never downloads anything.
#if (Ver < 0x06070300) || (Ver >= 0x06070400)
  #error Build this installer with the pinned Inno Setup 6.7.3 engine
#endif
#ifndef SOURCE_DIR
  #error SOURCE_DIR is required
#endif
#ifndef OUTPUT_DIR
  #error OUTPUT_DIR is required
#endif
#ifndef CHINESE_MESSAGES
  #define CHINESE_MESSAGES "compiler:Languages\ChineseSimplified.isl"
#endif
#define ProductAppId "io.github.fqxxzyw.yukino.base"
[Setup]
AppId={#ProductAppId}
AppName=Yukino Companion
AppVersion=0.4.0
AppPublisher=fqxxzyw
DefaultDirName={localappdata}\Programs\Yukino Companion
DefaultGroupName=Yukino Companion
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
UsePreviousAppDir=yes
DisableDirPage=no
DisableProgramGroupPage=yes
DisableWelcomePage=no
DisableReadyPage=yes
DisableFinishedPage=no
AllowCancelDuringInstall=yes
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\Yukino Companion.exe
UninstallDisplayName=Yukino Companion
WizardStyle=modern
WizardSizePercent=130,125
WizardResizable=no
ShowLanguageDialog=no
SetupIconFile={#AddBackslash(SourcePath)}..\branding\app-icon.ico
OutputDir={#OUTPUT_DIR}
OutputBaseFilename=Yukino-Companion-0.4.0-Base-Setup
Compression=lzma2/normal
SolidCompression=yes
DiskSpanning=no
UseSetupLdr=yes
SetupLogging=yes
[Languages]
Name: "zhcn"; MessagesFile: "{#CHINESE_MESSAGES}"
[LangOptions]
DialogFontName=Microsoft YaHei UI
DialogFontSize=10
WelcomeFontName=Microsoft YaHei UI
WelcomeFontSize=23
TitleFontName=Microsoft YaHei UI
TitleFontSize=11
[Messages]
SetupWindowTitle=安装 Yukino Companion
WelcomeLabel1=一方安静的空间。
WelcomeLabel2=文字聊天、人物陪伴。其他能力，按需要慢慢开启。
SelectDirLabel3=选择安装位置
SelectDirDesc=为 Yukino Companion 选择一个专用文件夹。
SelectDirBrowseLabel=应用只为当前 Windows 用户安装。
WizardInstalling=正在安装 Yukino Companion
InstallingLabel=正在将应用文件写入所选文件夹。
FinishedHeadingLabel=安装完成，欢迎来到雪乃身边。
FinishedLabel=应用已安装完成。启动后可先配置文字聊天，再按需添加语音与视觉。所有可选配置都可以跳过，不会自动下载大模型或推理环境。
ButtonNext=继续(&N)
ButtonInstall=安装(&I)
ButtonFinish=完成(&F)
ButtonBack=返回(&B)
ButtonCancel=取消(&C)
[Files]
Source: "{#SOURCE_DIR}\*"; DestDir: "{app}"; Excludes: "yukino-installation.json,uninstall-app-payload.ps1,Uninstall.exe,unins*.exe,unins*.dat"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\Yukino Companion"; Filename: "{app}\Yukino Companion.exe"; Check: CreateStartMenuShortcut
Name: "{autodesktop}\Yukino Companion"; Filename: "{app}\Yukino Companion.exe"; Check: CreateDesktopShortcut
[INI]
Filename: "{app}\yukino-base-installation.ini"; Section: "Installation"; Key: "AppId"; String: "{#ProductAppId}"; Flags: uninsdeleteentry uninsdeletesectionifempty
[Registry]
Root: HKCU; Subkey: "Software\Yukino Companion\Base"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; Flags: uninsdeletevalue uninsdeletekeyifempty
[Run]
Filename: "{app}\Yukino Companion.exe"; Description: "启动雪乃 · Yukino Companion"; Flags: nowait postinstall skipifsilent
[Code]
const
  ColorInk=$56321C;
  ColorMuted=$765D48;
  ColorSky=$FCF7F1;
  ColorSuccess=$557C42;
var
  DesktopShortcutCheck,StartMenuShortcutCheck:TNewCheckBox;
  ProgressPercent,InstallStageNote:TNewStaticText;
  FilesWritten:Boolean;
function NormalPath(Value:String):String;
begin Result:=RemoveBackslash(ExpandFileName(Value)); end;
function HasEntries(Directory:String):Boolean;
var Item:TFindRec;
begin
  Result:=False;
  if FindFirst(AddBackslash(Directory)+'*',Item) then
  begin
    try repeat if (Item.Name<>'.') and (Item.Name<>'..') then begin Result:=True; Break; end; until not FindNext(Item);
    finally FindClose(Item); end;
  end;
end;
function LinkedChildren(Directory:String):Boolean;
var Item:TFindRec;
begin
  Result:=False;
  if FindFirst(AddBackslash(Directory)+'*',Item) then
  begin
    try repeat
      if (Item.Name<>'.') and (Item.Name<>'..') then
      begin
        Result:=(Item.Attributes and $400)<>0;
        if (not Result) and ((Item.Attributes and $10)<>0) then Result:=LinkedChildren(AddBackslash(Directory)+Item.Name);
        if Result then Break;
      end;
    until not FindNext(Item); finally FindClose(Item); end;
  end;
end;
function LinkedParent(Directory:String):Boolean;
var Item:TFindRec; Parent:String;
begin
  Result:=False;
  repeat
    if FindFirst(Directory,Item) then begin try Result:=(Item.Attributes and $400)<>0; finally FindClose(Item); end; if Result then Exit; end;
    Parent:=RemoveBackslash(ExtractFileDir(Directory));
    if (Parent='') or (CompareText(Parent,Directory)=0) then Exit;
    Directory:=Parent;
  until False;
end;
function Owned(Directory:String):Boolean;
var Registered,Uninstaller:String;
begin
  Result:=False;
  if GetIniString('Installation','AppId','',AddBackslash(Directory)+'yukino-base-installation.ini')<>'{#ProductAppId}' then Exit;
  if not RegQueryStringValue(HKCU,'Software\Yukino Companion\Base','InstallDir',Registered) then Exit;
  if CompareText(NormalPath(Registered),Directory)<>0 then Exit;
  if not RegQueryStringValue(HKCU,'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#ProductAppId}_is1','UninstallString',Uninstaller) then Exit;
  Uninstaller:=RemoveQuotes(Uninstaller);
  if CompareText(NormalPath(ExtractFileDir(Uninstaller)),Directory)<>0 then Exit;
  Result:=FileExists(Uninstaller) and FileExists(ChangeFileExt(Uninstaller,'.dat')) and FileExists(AddBackslash(Directory)+'Yukino Companion.exe') and FileExists(AddBackslash(Directory)+'resources\app.asar');
end;
function DirectoryProblem:String;
var Directory,UserProfile:String;
begin
  Result:=''; Directory:=NormalPath(WizardDirValue); UserProfile:=GetEnv('USERPROFILE');
  if (Length(Directory)<4) or (CompareText(Directory,RemoveBackslash(ExtractFileDrive(Directory)))=0) or
     (CompareText(Directory,NormalPath(ExpandConstant('{userappdata}')))=0) or
     (CompareText(Directory,NormalPath(ExpandConstant('{localappdata}')))=0) or
     ((UserProfile<>'') and (CompareText(Directory,NormalPath(UserProfile))=0)) then
  begin Result:='请选择一个专用的应用文件夹，不要选择磁盘或用户数据根目录。'; Exit; end;
  if FileExists(Directory) then begin Result:='所选路径是文件，请另选文件夹。'; Exit; end;
  if LinkedParent(Directory) or LinkedChildren(Directory) then begin Result:='所选文件夹包含目录链接，请选择普通文件夹。'; Exit; end;
  if HasEntries(Directory) and (not Owned(Directory)) then Result:='这个文件夹已有内容，无法确认属于本安装器。请选择新空文件夹，或先在 Windows 设置卸载旧版。聊天、设置及已下载资源会保留。';
end;
function NextButtonClick(CurPageID:Integer):Boolean;
var Problem:String;
begin Result:=True; if CurPageID=wpSelectDir then begin Problem:=DirectoryProblem; Result:=Problem=''; if not Result then SuppressibleMsgBox(Problem,mbError,MB_OK,IDOK); end; end;
function PrepareToInstall(var NeedsRestart:Boolean):String;
begin Result:=DirectoryProblem; end;
function CreateDesktopShortcut:Boolean;
begin Result:=DesktopShortcutCheck.Checked; end;
function CreateStartMenuShortcut:Boolean;
begin Result:=StartMenuShortcutCheck.Checked; end;
procedure StyleLabel(Control:TNewStaticText; Size:Integer; Bold:Boolean);
begin Control.Font.Name:='Microsoft YaHei UI'; Control.Font.Size:=Size; Control.Font.Color:=ColorInk; if Bold then Control.Font.Style:=[fsBold] else Control.Font.Style:=[]; end;
function AddText(Parent:TWinControl; Text:String; Left,Top,Width,Height,Size:Integer; Bold:Boolean):TNewStaticText;
begin
  Result:=TNewStaticText.Create(WizardForm); Result.Parent:=Parent; Result.AutoSize:=False; Result.WordWrap:=True;
  Result.Caption:=Text; Result.SetBounds(Left,Top,Width,Height); StyleLabel(Result,Size,Bold);
end;
procedure InitializeWizard;
var Card:TPanel; Note:TNewStaticText; W:Integer;
begin
  WizardForm.Font.Name:='Microsoft YaHei UI'; WizardForm.Font.Color:=ColorInk; WizardForm.Color:=ColorSky;
  WizardForm.WelcomePage.Color:=ColorSky; WizardForm.FinishedPage.Color:=ColorSky; WizardForm.MainPanel.Color:=ColorSky;
  WizardForm.Bevel.Visible:=False; WizardForm.Bevel1.Visible:=False;
  WizardForm.WizardBitmapImage.Visible:=False; WizardForm.WizardBitmapImage2.Visible:=False; WizardForm.WizardSmallBitmapImage.Visible:=False; WizardForm.SelectDirBitmapImage.Visible:=False;
  W:=WizardForm.WelcomePage.ClientWidth-ScaleX(80);
  Note:=AddText(WizardForm.WelcomePage,'YUKINO COMPANION  /  {#SetupSetting("AppVersion")}',ScaleX(42),ScaleY(14),W,ScaleY(24),9,True); Note.Font.Color:=ColorMuted;
  WizardForm.WelcomeLabel1.AutoSize:=False; WizardForm.WelcomeLabel1.SetBounds(ScaleX(40),ScaleY(46),W,ScaleY(48)); StyleLabel(WizardForm.WelcomeLabel1,23,True);
  WizardForm.WelcomeLabel2.AutoSize:=False; WizardForm.WelcomeLabel2.SetBounds(ScaleX(42),ScaleY(104),W,ScaleY(36)); StyleLabel(WizardForm.WelcomeLabel2,11,False);
  Card:=TPanel.Create(WizardForm); Card.Parent:=WizardForm.WelcomePage; Card.SetBounds(ScaleX(40),ScaleY(143),W,ScaleY(143)); Card.BevelOuter:=bvNone; Card.ParentBackground:=False; Card.Color:=clWhite;
  AddText(Card,'01  安装应用',ScaleX(20),ScaleY(16),W-ScaleX(40),ScaleY(26),11,True);
  AddText(Card,'轻量安装，直接开始配置 API 对话。',ScaleX(20),ScaleY(47),W-ScaleX(40),ScaleY(26),10,False);
  AddText(Card,'02  按需添加资源',ScaleX(20),ScaleY(82),W-ScaleX(40),ScaleY(26),11,True);
  AddText(Card,'打开应用后，再安装模型、音色与推理环境。',ScaleX(20),ScaleY(111),W-ScaleX(40),ScaleY(28),10,False);
  Note:=AddText(WizardForm.WelcomePage,'安装过程不下载资源。所有下载均在应用内由你选择。',ScaleX(42),ScaleY(307),W,ScaleY(44),9,False); Note.Font.Color:=ColorMuted;
  StyleLabel(WizardForm.PageNameLabel,14,True); StyleLabel(WizardForm.PageDescriptionLabel,9,False);
  WizardForm.PageNameLabel.Left:=ScaleX(28); WizardForm.PageNameLabel.Width:=WizardForm.MainPanel.ClientWidth-ScaleX(56);
  WizardForm.PageDescriptionLabel.Left:=ScaleX(28); WizardForm.PageDescriptionLabel.Width:=WizardForm.PageNameLabel.Width;
  W:=WizardForm.SelectDirPage.ClientWidth; WizardForm.SelectDirLabel.SetBounds(0,ScaleY(12),W,ScaleY(45));
  WizardForm.SelectDirLabel.Caption:='只为当前 Windows 用户安装。请选择一个专用文件夹。'; WizardForm.SelectDirBrowseLabel.Visible:=False;
  WizardForm.DirEdit.SetBounds(0,ScaleY(70),W-ScaleX(98),ScaleY(28)); WizardForm.DirBrowseButton.SetBounds(W-ScaleX(88),ScaleY(69),ScaleX(88),ScaleY(30));
  DesktopShortcutCheck:=TNewCheckBox.Create(WizardForm); DesktopShortcutCheck.Parent:=WizardForm.SelectDirPage; DesktopShortcutCheck.Caption:='在桌面创建快捷方式'; DesktopShortcutCheck.Checked:=True; DesktopShortcutCheck.SetBounds(0,ScaleY(121),(W-ScaleX(20)) div 2,ScaleY(28));
  StartMenuShortcutCheck:=TNewCheckBox.Create(WizardForm); StartMenuShortcutCheck.Parent:=WizardForm.SelectDirPage; StartMenuShortcutCheck.Caption:='添加到开始菜单'; StartMenuShortcutCheck.Checked:=True; StartMenuShortcutCheck.SetBounds((W+ScaleX(20)) div 2,ScaleY(121),(W-ScaleX(20)) div 2,ScaleY(28));
  Note:=AddText(WizardForm.SelectDirPage,'聊天与设置保存在用户数据目录。之后下载的资源默认保存在本安装文件夹的 Yukino-Data 子目录，卸载时保留。',0,ScaleY(170),W,ScaleY(60),9,False); Note.Font.Color:=ColorMuted;
  W:=WizardForm.InstallingPage.ClientWidth; WizardForm.StatusLabel.SetBounds(0,ScaleY(16),W,ScaleY(34));
  ProgressPercent:=AddText(WizardForm.InstallingPage,'0% · 文件写入',0,ScaleY(66),W,ScaleY(48),23,True);
  WizardForm.ProgressGauge.SetBounds(0,ScaleY(130),W,ScaleY(12)); WizardForm.FilenameLabel.Visible:=False;
  InstallStageNote:=AddText(WizardForm.InstallingPage,'百分比仅表示当前文件写入进度。安装器还会完成快捷方式与卸载信息；出现完成页后，才表示应用安装成功。',0,ScaleY(165),W,ScaleY(80),10,False);
  W:=WizardForm.FinishedPage.ClientWidth-ScaleX(80);
  Note:=AddText(WizardForm.FinishedPage,'✓  应用已安装',ScaleX(42),ScaleY(26),W,ScaleY(28),12,True); Note.Font.Color:=ColorSuccess;
end;
procedure CurPageChanged(CurPageID:Integer);
var W:Integer;
begin
  if CurPageID=wpFinished then begin
    W:=WizardForm.FinishedPage.ClientWidth-ScaleX(80); WizardForm.FinishedHeadingLabel.AutoSize:=False;
    WizardForm.FinishedHeadingLabel.SetBounds(ScaleX(40),ScaleY(72),W,ScaleY(66)); StyleLabel(WizardForm.FinishedHeadingLabel,21,True);
    WizardForm.FinishedLabel.SetBounds(ScaleX(42),ScaleY(150),W,ScaleY(92)); StyleLabel(WizardForm.FinishedLabel,11,False);
    WizardForm.RunList.SetBounds(ScaleX(42),ScaleY(258),W,ScaleY(52));
  end;
end;
procedure CurStepChanged(CurStep:TSetupStep);
begin
  if CurStep=ssPostInstall then begin
    FilesWritten:=True;
    ProgressPercent.Caption:='文件已写入';
    InstallStageNote.Caption:='应用文件已写入，正在结束安装。请等待安装器进入完成页；此时尚未启动应用，也没有下载推理资源。';
  end;
end;
procedure CurInstallProgressChanged(CurProgress,MaxProgress:Integer);
begin
  if (MaxProgress>0) and (not FilesWritten) then
    ProgressPercent.Caption:=IntToStr(Round(100.0*CurProgress/MaxProgress))+'% · 文件写入';
end;
{ Inno's uninstall log removes only installed files; user data is never registered. }
