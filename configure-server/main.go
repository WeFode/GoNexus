package main

import (
	_ "configure-server/internal/packed"

	_ "github.com/gogf/gf/contrib/drivers/pgsql/v2"

	_ "configure-server/internal/logic"

	"github.com/gogf/gf/v2/os/gctx"

	"configure-server/internal/cmd"
)

func main() {
	cmd.Main.Run(gctx.GetInitCtx())
}
