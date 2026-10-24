# Telegram Bot ↔ Dot 插件

目标：把 Telegram 消息通过 MCP Events 送入 Dot，并通过工具回复或更新 Telegram 消息。

**当前状态：源码恢复待完成。本仓库目前只有安装约定和来源记录，不能安装或部署。** 原运行插件仍独立运行，本仓库的创建没有改变它的配置。

## 交给 Agent 的一句话

> 请读取 https://github.com/vingeraycn/telegram-dot-plugin 的 INSTALL.md，先核实源码完整性，再按文档安装并引导我安全地完成交互式配置；若源码或受支持的部署方式缺失，请明确报告阻碍，不要猜测命令，也不要修改我现有的 Bot 或 webhook。

这是私有仓库。其他用户及其 Agent 必须先获得仓库读取权限；仓库所有者需要自行决定授权，不应为了安装擅自公开仓库。

## 已知接口

- 事件：`telegram.message.received`
- 工具：`get_bridge_status`、`read_telegram_message`、`reply_telegram_message`、`update_telegram_message`

这些名称来自原插件记录，尚未从源码核验参数和实现。不能仅根据名称构造调用参数或重新实现后声称是原源码。

参见 [安装与安全配置约定](INSTALL.md) 和 [来源与恢复状态](SOURCE_STATUS.md)。
