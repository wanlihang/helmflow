# Goal 13 — 项目注册:API + Portal UI 一键入驻新应用 (精简版,3950字符以内)

> 直接复制下面的代码块内容到 Claude Code 即可。

```
/goal 在 G12 基础上新增项目注册:Portal 表单 → 后端校验 → 写 helmcode.yaml + DB projects 表 → 自动出现在项目下拉。前置:G12 已 commit;manifest-loader + ProjectSwitcher + cookie 已就位。

【范围】
1. 扩 packages/storage/src/schema.ts:新增 projects 表
   {id:pk(text),name:notNull,adapterType:notNull,sandboxPath:notNull,standardsRoot,featureMatrixPath:notNull,repoUrl,description,manifestPath:notNull,status:notNull default'active',registeredAt:timestamp notNull}
   导出 ProjectRow/ProjectInsert。db.ts DDL 追加 CREATE TABLE projects。
   repo.ts 新增:createProject/getProjectById/listProjectsDb/updateProject/softDeleteProject。

2. 扩 packages/manifest-loader/src/index.ts:
   新增 createManifest(projectId,manifest)→mkdirSync+writeFileSync helmcode.yaml
   新增 deleteManifest(projectId)。ManifestSchema 加 repoUrl?+description?

3. 新 apps/portal/app/api/projects/route.ts:
   POST 注册:body{id,name,adapterType,sandboxPath,standardsRoot?,featureMatrixPath?,repoUrl?,description?}
   校验:ID正则/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/ + 唯一(DB+文件系统) + 必填非空 + adapterType枚举 + sandboxPath目录存在
   副作用:createManifest+createProject+syncMatrixToDb。返回201{project}
   GET 列表:DB查status='active',附featureCount。返回{projects:[...]}

4. 新 apps/portal/app/api/projects/[id]/route.ts:
   GET详情:DB查+features按status聚合stats。PATCH更新:校验存在+枚举+路径,覆写yaml+DB。
   DELETE注销:id!=='mycmdeliverhub',softDeleteProject,不删文件。

5. 新 apps/portal/components/register-project-dialog.tsx:
   'use client',用已有Dialog/Button/Textarea。字段:ID*(text)/名称*(text)/适配器*(select:java-ddd,node-express)/沙箱路径*(text)/Matrix路径(text)/规范目录(text)/Git地址(text)/描述(textarea)。
   ID onBlur实时校验。提交POST成功→router.refresh()关闭Dialog。错误底部red-box显示。

6. 改 project-switcher.tsx:下拉旁加"+"按钮(lucide Plus icon),开RegisterProjectDialog。单项目也显示"+"。

7. 改 lib/project.ts:getProjectList()优先DB,回落manifest-loader。

8. 改 lib/sync-matrix.ts:syncMatrixToDb处理空矩阵不报错。

【约束】双写(yaml+DB)/注销不删文件/不改loadManifest/ID不可改/默认项目不可删/不clone仓库/严格TS禁any

【通过信号】
1.pnpm -r typecheck 0 error
2.Portal顶部"+"按钮可见
3.注册id=demo-project,name=演示,adapterType=node-express,sandboxPath=./apps/sandbox-node→201→下拉可见
4.切到demo-project→空矩阵
5.切回mycmdeliverhub→数据不变
6.重复注册demo-project→409
7.sandboxPath=./nonexistent→400
8.sqlite3查projects表有demo-project active
9.projects/demo-project/helmcode.yaml存在含name
10.DELETE /api/projects/demo-project→200→inactive→文件仍存在
11.存在性:storage schema+repo含projects/manifest-loader含createManifest/api/projects route+[id]route/register-project-dialog.tsx

完成后输出"Goal 13 验收清单"。
```
