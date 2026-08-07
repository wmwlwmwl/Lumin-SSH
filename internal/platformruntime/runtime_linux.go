//go:build linux

package platformruntime

import "github.com/wailsapp/wails/v2/pkg/options"

// ApplyOptions 在 Linux 上无需附加平台选项。
func ApplyOptions(_ *options.App, _ bool) {}
