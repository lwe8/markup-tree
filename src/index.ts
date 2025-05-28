import fs from "node:fs/promises";
import path from "node:path";
// Types

type FrontMatterResult<T = Record<string, any>> = {
  content: string;
  meta: T;
};

type MarkupParser = (content: string) => string | Object;

type MarkupExtension = ".md" | ".mdx" | ".textile";

type OutExtension = ".js" | ".jsx" | ".tsx" | ".ts";

type TemplateFunction = (
  input: string | Object,
  dada?: Record<string, any>
) => string;

interface MarkupOptions {
  filterExtension?: MarkupExtension;
  outExtension?: OutExtension;
  outDir?: string;
  apiRoot?: string;
  postsDir?: string;
}
interface MarkupFileTree<T = Record<string, any>> {
  slug: string;
  parsedMarkup: string | Object;
  frontMatterData: T;
  out: {
    parentPath: string;
    outFileName: string;
    outFilePath: string;
  };
  html: {
    parentPath: string;
    outFilePath: string;
  };
  api: {
    route: string;
    pattern: string;
  };
  fsStat: {
    size: number;
    createAt: Date;
    lastAccess: Date;
    lastModified: Date;
    birthtimeMs: number;
  };
}
type ApiTree<T = Record<string, any>> = Pick<
  MarkupFileTree<T>,
  "parsedMarkup" | "frontMatterData" | "api"
>;
type HtmlFileTree<T = Record<string, any>> = Pick<
  MarkupFileTree<T>,
  "parsedMarkup" | "frontMatterData" | "html"
>;
type FilesTree<T = Record<string, any>> = Pick<
  MarkupFileTree<T>,
  "parsedMarkup" | "frontMatterData" | "out"
>;
interface WriteOptions {
  templateFunction?: TemplateFunction;
  writeOption?: "html" | "files";
}
// --- types end

export class MarkupTree {
  private _folderPath: string;
  private _filterExtension: MarkupExtension;
  private _markupParser: MarkupParser | ((input: string) => string);
  private _outDir: string;
  private _outExtension: OutExtension;
  private _apiRoot: string;
  private _potsDir: string;
  private _fp: string;

  constructor(
    folderPath: string,
    markupParser?: MarkupParser,
    options?: MarkupOptions
  ) {
    this._folderPath = path.resolve(process.cwd(), folderPath);
    this._fp = folderPath;
    this._filterExtension = options?.filterExtension ?? ".md";
    this._markupParser =
      markupParser ??
      function (input: string) {
        return input;
      };
    this._outExtension = options?.outExtension ?? ".js";
    this._outDir = options?.outDir ? options?.outDir : ".";
    this._apiRoot = options?.apiRoot ? `/${options?.apiRoot}` : "/posts";
    this._potsDir = options?.postsDir ? options?.postsDir : ".";
  }
  static frontMatter<T = Record<string, any>>(
    rawMarkup: string
  ): FrontMatterResult<T> {
    let result: FrontMatterResult<T> = {
      content: "",
      meta: {} as T,
    };
    const regex =
      /^(---\r?\n(?<frontText>[\s\S]*?\r?\n?)---\r?\n)(?<body>[\s\S]*$)/;
    const match = regex.exec(rawMarkup);
    if (match?.groups) {
      const { frontText, body } = match.groups;
      result.content = body;
      const lines = frontText.split("\n");
      for (const line of lines) {
        const [key, value] = line.split(":");
        if (key && value) {
          result.meta[key] = value.trim();
        }
      }
    }
    return result;
  }
  private async fromFile<T = Record<string, any>>(
    filePath: string
  ): Promise<{} | Partial<MarkupFileTree<T>>> {
    if (path.extname(filePath) === this._filterExtension) {
      const resolvePath = path.resolve(process.cwd(), filePath);
      const rawMarkup = await fs.readFile(resolvePath, "utf8");
      const stat = await fs.stat(resolvePath);
      const { content, meta } = MarkupTree.frontMatter<T>(rawMarkup);
      return {
        parsedMarkup: this._markupParser(content),
        frontMatterData: meta ?? ({} as T),
        fsStat: {
          size: stat.size,
          createAt: stat.ctime,
          lastAccess: stat.atime,
          lastModified: stat.mtime,
          birthtimeMs: stat.birthtimeMs,
        },
      };
    }
    return {};
  }
  private async fromFolder<T = Record<string, any>>(
    folderPath: string
  ): Promise<MarkupFileTree<T>[]> {
    // must be resolved path
    const files = await fs.readdir(folderPath, { withFileTypes: true });

    const tree = await Promise.all(
      files
        .filter(
          (f) => f.isFile() && path.extname(f.name) === this._filterExtension
        )
        .map(async (file) => {
          const filePath = path.join(folderPath, file.name);
          const data = await this.fromFile<T>(filePath);
          // length of cwd
          const cwdl = process.cwd().split(path.sep).length;
          // input folder path length
          const fpl = this._fp.split("/").length;
          // out file name
          const fn = file.name.replace(
            path.extname(file.name),
            this._outExtension
          );
          // route path
          const rp = file.parentPath
            .split(path.sep)
            .slice(cwdl + fpl)
            .join(path.sep);
          const _slug = file.name.split(".")[0];
          return {
            ...data,
            slug: _slug,
            out: {
              parentPath: path.join(
                process.cwd(),
                this._outDir,
                this._potsDir,
                rp
              ),
              outFileName: fn,
              outFilePath: path.join(
                process.cwd(),
                this._outDir,
                this._potsDir,
                rp,
                fn
              ),
            },
            html: {
              parentPath: path.join(
                process.cwd(),
                this._outDir,
                this._potsDir,
                rp,
                _slug
              ),
              outFilePath: path.join(
                process.cwd(),
                this._outDir,
                this._potsDir,
                rp,
                _slug,
                "index.html"
              ),
            },
            api: {
              route: this._apiRoot,
              pattern: `${this._apiRoot}:${file.name.split(".")[0]}`,
            },
          } as MarkupFileTree<T>;
        })
    );
    const folders = files.filter((f) => f.isDirectory());
    if (folders.length) {
      const subFolders = await Promise.all(
        folders.map(async (folder) => {
          const subFolder = path.join(folderPath, folder.name);
          const subTree = await this.fromFolder<T>(subFolder);
          return subTree;
        })
      );

      for (const subTree of subFolders) {
        if (subTree) {
          tree.push(...subTree);
        }
      }
    }
    return tree;
  }
  async tree<T = Record<string, any>>() {
    const nodes: MarkupFileTree<T>[] = await this.fromFolder<T>(
      this._folderPath
    );
    nodes.sort((a, b) => b.fsStat.birthtimeMs - a.fsStat.birthtimeMs);
    return nodes;
  }
  async apiTree<T = Record<string, any>>(): Promise<ApiTree<T>[]> {
    const nodes: MarkupFileTree<T>[] = await this.tree<T>();
    const apiNodes: ApiTree<T>[] = [];
    nodes.forEach((node) => {
      apiNodes.push({
        parsedMarkup: node.parsedMarkup,
        frontMatterData: node.frontMatterData,
        api: node.api,
      });
    });
    return apiNodes;
  }
  async htmlFileTree<T = Record<string, any>>(): Promise<HtmlFileTree<T>[]> {
    const nodes: MarkupFileTree<T>[] = await this.tree<T>();
    const htmlNodes: HtmlFileTree<T>[] = [];
    nodes.forEach((node) => {
      htmlNodes.push({
        parsedMarkup: node.parsedMarkup,
        frontMatterData: node.frontMatterData,
        html: node.html,
      });
    });
    return htmlNodes;
  }
  async filesTree<T = Record<string, any>>() {
    const nodes: MarkupFileTree<T>[] = await this.tree<T>();
    const filesNodes: FilesTree<T>[] = [];
    nodes.forEach((node) => {
      filesNodes.push({
        parsedMarkup: node.parsedMarkup,
        frontMatterData: node.frontMatterData,
        out: node.out,
      });
    });
    return filesNodes;
  }
  set outExtension(ext: OutExtension) {
    this._outExtension = ext;
  }
  set outDir(dir: string) {
    this._outDir = dir;
  }
  set apiRoot(dir: string) {
    this._apiRoot = dir;
  }
  set postsDir(dir: string) {
    this._potsDir = dir;
  }
  async write<T = Record<string, any>>(options?: WriteOptions) {
    const _writeOption = options?.writeOption ?? "html";
    if (_writeOption === "files") {
      if (!options?.templateFunction) {
        throw new Error(
          "For out file extension .js .jsx .ts .tsx templateFunction must be required"
        );
      } else {
        const tree = await this.filesTree<T>();
        tree.forEach(async (node) => {
          await fs.mkdir(node.out.parentPath, { recursive: true });
          const data = node.frontMatterData ? node.frontMatterData : undefined;
          const content = options?.templateFunction
            ? options?.templateFunction(node.parsedMarkup, data)
            : (node.parsedMarkup as string);
          await fs.writeFile(node.out.outFilePath, content);
        });
      }
    } else {
      const tree = await this.htmlFileTree<T>();
      tree.forEach(async (node) => {
        if (
          typeof node.parsedMarkup === "object" &&
          !options?.templateFunction
        ) {
          throw new Error(
            "For out file extension .html templateFunction must be required or parsedMarkup must be string"
          );
        } else {
          await fs.mkdir(node.html.parentPath, { recursive: true });
          const data = node.frontMatterData ? node.frontMatterData : undefined;
          const content = options?.templateFunction
            ? options?.templateFunction(node.parsedMarkup, data)
            : (node.parsedMarkup as string);
          await fs.writeFile(node.html.outFilePath, content);
        }
      });
    }
  }
}
