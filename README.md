# WebDAV Sync

WebDAV Sync 是一个 VS Code 扩展，用于实时同步本地文件到 WebDAV 服务器。它支持文件的自动同步、手动同步以及同步控制功能。

## 功能特点

- 🔄 实时同步：自动监听文件变化并同步到 WebDAV 服务器
- 📁 支持目录同步：可以同步单个文件或整个目录
- 🎮 同步控制：支持暂停/恢复同步功能
- 🖱️ 右键菜单集成：在文件资源管理器中快速访问同步功能
- 📝 详细日志：提供同步操作的详细日志记录

## 安装

在 VS Code 扩展市场中搜索 "webdav-sync" 并安装。

## 配置

在 VS Code 设置中配置以下选项：

1. `webdav-sync.serverHost`: WebDAV 服务器地址
   - 示例：`http://1.1.1.1:8080/webdav`
   - 必须包含协议、主机、端口和路径

2. `webdav-sync.username`: WebDAV 服务器用户名

3. `webdav-sync.password`: WebDAV 服务器密码

4. `webdav-sync.remotePath`: 远程服务器的文件路径
   - 指定文件将被同步到服务器的哪个位置

5. `webdav-sync.localPath`: 本地路径
   - 默认值：`${workspaceFolder}`（当前工作区目录）

这里重点说明一下本地路径、服务器路径、服务器地址之间的关系：

- 服务器地址是指你的webdav服务器的地址，例如`http://1.1.1.1:8080/webdav`，包含有协议、主机、端口和路径，就像是具有一个webdav的一个接口一样。

- 服务器路径是指你希望将本地文件同步到webdav服务器的哪个位置，例如`/webdav/test`，这个路径是相对于服务器地址的，也就是说，你的webdav服务器地址是`http://1.1.1.1:8080/webdav`，那么服务器路径就是`/test`。

- 本地路径是与你`服务器路径`相对应的，成映射关系。当有一个文件需要同步时，会将文件路径中的`本地路径`替换为`服务器路径`，然后同步到webdav服务器。

举个例子：

通过nginx配置了一个path `/webdav/`为webdav服务器，我要将本地的`/Users/XiaoMing/Developer/code/text.js`同步到webdav服务器的`http://1.1.1.1:8080/webdav/code/text.js`，那么需要配置为：

- 服务器地址：`http://1.1.1.1:8080/webdav/`
- 服务器路径：`/`
- 本地路径：`/Users/XiaoMing/Developer/`


## 使用方法

### 自动同步

安装并配置后，扩展会自动监听文件变化并同步到 WebDAV 服务器。

### 手动同步

1. 单个文件/目录同步：
   - 在文件资源管理器中右键点击文件或目录
   - 选择 "Sync File To WebDAV"

2. 同步所有文件：
   - 打开命令面板（Ctrl+Shift+P 或 Cmd+Shift+P）
   - 输入并选择 "Sync All To WebDAV Server"

### 同步控制

1. 暂停同步：
   - 命令面板中输入 "暂停 WebDAV 同步"
   - 暂停后，文件变更将不会被同步

2. 恢复同步：
   - 命令面板中输入 "恢复 WebDAV 同步"
   - 恢复后，新的文件变更会继续同步

## 注意事项

- 默认不同步隐藏文件（以 . 开头的文件/目录）
- 首次使用前请确保 WebDAV 服务器配置正确
- 建议在进行大量文件操作前暂停同步，完成后再恢复

## 问题反馈

如果您遇到任何问题或有改进建议，请在 GitHub 仓库提交 Issue。

## 许可证

MIT License
