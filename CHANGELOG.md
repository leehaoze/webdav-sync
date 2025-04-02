# Change Log

All notable changes to the "webdav-sync" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.6] - 2024-03-21

### 修复
- 修复了配置错误时插件命令完全不可用的问题
  - 即使WebDAV连接失败，插件现在也会正常加载所有命令
  - 添加了重连功能，可以通过命令面板或状态栏重新连接WebDAV服务器
  - 在执行同步命令时会检查连接状态并提供清晰的错误提示

- 修复了Windows系统下路径处理的问题
  - 正确处理Windows系统的反斜杠和盘符
  - 修复了远程路径包含完整本地路径的问题
  - 优化了工作区路径变量的处理

- 改进了配置更新机制
  - 添加了配置变更监听，实时响应配置修改
  - 配置更改后自动重新初始化连接和路径
  - 提供更详细的日志输出，方便排查问题

### 新功能
- 添加了新的"Reconnect WebDAV"命令
- 状态栏现在显示更详细的连接状态
- 添加了更多的错误提示和用户反馈
