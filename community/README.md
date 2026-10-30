# Yukino 社区网页

这是独立于桌面 EXE 的社区前端源码，供继续开发与本地检查。

## 本地检查与构建

从仓库根目录运行：

```sh
node --test community/tests/*.test.mjs
node community/build.mjs
```

构建输出为 `build/community`。

这些命令不代表已完成真实浏览器视觉验收，也不代表桌面程序已通过 Windows 验收。
