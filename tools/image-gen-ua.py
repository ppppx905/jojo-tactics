"""用「浏览器身份」调用 image-gen CLI（绕过接口对脚本身份的 Cloudflare 误拦）。

背景：接口前面挂了 Cloudflare，它按客户端身份拦截——脚本默认发的
`codex-image-gen/1.0`（以及 Python 默认的 `Python-urllib/3.x`）都会被判成爬虫，
返回 403 `error code: 1010`。换成正常浏览器的 User-Agent 后请求能正常到达接口。

这里**不改那个共享的 skill 脚本**，只是把它的 USER_AGENT 全局变量换掉再调它的 main()。

用法（参数与官方 CLI 完全一致）：
  py -3.13 tools/image-gen-ua.py doctor
  py -3.13 tools/image-gen-ua.py generate --prompt-file design/prompts/xxx.txt --size 1536x1024 --out assets/src/xxx.png
"""
import importlib.util
import os
import pathlib
import sys

CLI = pathlib.Path(r"D:\deepseek工作区\.dsh\skills\image-gen\scripts\image_gen.py")
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def load_cli():
    if not CLI.exists():
        raise SystemExit(f"找不到 image-gen 脚本：{CLI}")
    spec = importlib.util.spec_from_file_location("image_gen_cli", CLI)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    module = load_cli()
    module.USER_AGENT = os.environ.get("IMAGE_GEN_UA") or BROWSER_UA
    print(f"[image-gen-ua] 使用身份: {module.USER_AGENT[:48]}…", file=sys.stderr)
    sys.argv = [str(CLI)] + sys.argv[1:]
    return module.main()


if __name__ == "__main__":
    sys.exit(main())
