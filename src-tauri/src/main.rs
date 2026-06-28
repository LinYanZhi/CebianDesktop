// 防止在 Windows 发布模式下显示控制台窗口，请勿删除！！
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cebianbridgerust_lib::run();
}
