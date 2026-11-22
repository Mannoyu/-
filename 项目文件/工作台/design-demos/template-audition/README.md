# 固定模板 · 独立试听

通过项目现有 HTTP 服务访问 `/project/design-demos/template-audition/index.html`。

如果服务已关闭，在项目 `outputs/music-wallpaper` 目录运行 `node open-preview.mjs`，取终端打印的地址端口，再打开上述路径。

此页面默认演示副歌短片段，可切换主歌及下一组背景。点击“播放试听”播放原音轨；“当前模板 / 本次 Demo”在同一时间点对照。全屏后按 Esc 退出。

本次没有修改主页面、主模板配置、歌曲数据或源素材。`preview.js` 负责试听控制，`treatment.js/css` 只在本页面的 iframe 内启用。删除或停用本目录不影响主工程。

校验命令：

```bash
node design-demos/template-audition/check-preview.mjs http://127.0.0.1:PORT/project/design-demos/template-audition/index.html
```

将 PORT 替换为正在运行的端口。检查结果保存在本目录。
