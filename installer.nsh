!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "格物" '"$INSTDIR\格物.exe" --hidden'
!macroend
