# Java Spring Boot DDD 编码标准

> 基于 7 个 SOFABoot 项目的实际代码模式分析建立。
> 本标准提供完整的默认规范，可直接用于新项目。
> 已有项目安装时，`helmcode install` 会扫描代码检测差异，生成 `.claude/standards/project-conventions.md` 覆盖默认值。

## 0. 核心原则:按业务功能点 `{context}` 内聚

> **AI coding 时代,以业务功能划分才是最内聚的——而不是按技术分层散落。**
> 一条业务需求,通过包路径 10 秒内定位到所有相关代码;改一个功能,不需要在
> `handler/`、`action/`、`acceptor/` 三个水平包之间跳来跳去。

### 0.1 包结构铁律

同一功能点的 **Facade + Acceptor + Handler + Action + Context** 必须收敛在同一 `{context}` 包下:

```
✅ 正确(按业务功能内聚)
application/mapping/acceptor/ProdMappingAcceptor.java
application/mapping/handler/ProductMappingSubmitHandler.java
application/mapping/action/SavePdMappingAction.java
application/mapping/context/ProdMappingContext.java

❌ 错误(按技术关注水平分包)
application/acceptor/ProdMappingAcceptor.java
application/handler/ProductMappingSubmitHandler.java
application/action/SavePdMappingAction.java
```

完整包结构约定见 `package-structure.md`(随 init-java-ddd skill 安装到
`.claude/skills/init-java-ddd/references/package-structure.md`,源码仓库位于
`core/init-java-ddd/references/package-structure.md`)。

### 0.2 跨功能点共享才能放顶层

只有满足以下条件之一,才能放在 `{module}/` 顶层(不带 `{context}`):
- 被两个以上 `{context}` 引用(如 `application/decider/`、`application/shared/handler/`)
- 技术基础设施,不属于业务(如 `infrastructure/config/`、`infrastructure/log/`、`infrastructure/messaging/`)
- 通用查询/异常转换(如 `facade/shared/`)

### 0.3 编排路径决策:Service vs Handler+Action

判定按从上往下,**第一个命中**即定:

| 触发条件(任一命中) | 走法 | 路径 |
|---|---|---|
| 含审批回调 / 状态机分支(PASS/REJECT/CANCEL) | StatefulHandlerTemplate | route() + onPass/onReject/onCancel |
| ≥4 步业务动作,**或**需要细粒度事务边界控制(单 Action 单事务) | Handler + Action | FacadeImpl → BizTemplate → Acceptor → Handler.execute(ctx) |
| ≤3 步且整体一个事务(校验→调服务→持久化) | Application Service | FacadeImpl → BizTemplate → Service |

> **判定原则**:动作步数从契约的"业务规则/流程"段计数,一次 DB 写入或一次外部调用 = 一步。
> 4-5 步落进"多步编排"——不是模糊地带。

详见 [`patterns/handler.md`](patterns/handler.md) 与 [`patterns/acceptor.md`](patterns/acceptor.md)。

### 0.4 零项目专有元数据

- 不发明 `@HelmFlow` / `@StageStep` 之类的自定义业务注解
- 不引入 flow XML 编排引擎(`代码顺序即执行顺序`,doHandle() 里写什么就执行什么)
- 不引入"AI 友好"的额外插件——Spring/SOFA/Lombok/MapStruct 已足够

## 1. 分层与依赖

- bootstrap → facade → application → domain，infrastructure → domain（依赖倒置）
- 领域层不依赖任何其他层，只依赖基础库
- Facade 接口在 facade 模块，实现在 application 模块
- 接口定义在上层，实现在下层

## 2. 注解规则

| 类型 | 必须使用 | 禁止使用 |
|------|---------|---------|
| Entity | @Getter + @Setter | @Data, @AllArgsConstructor, @NoArgsConstructor |
| ValueObject | @Data | - |
| DO | @Data（审计字段内联声明，不继承基类）| extends 任何基类 |
| Request/Command/Query | @Data（extends BaseRequest 时加 @EqualsAndHashCode(callSuper=true)）| - |
| Facade 实现 | @RpcProvider 或 @SofaService | @Service（单独使用） |
| Facade 方法 | @FacadeIntercept(loggerName = MycmLoggerDef.FACADE_SERVICE_LOGGER) | - |
| Application Service | @Service | - |
| Repository 实现 | @Repository | - |
| 领域层 | - | @Slf4j（禁止日志） |
| Domain Service | @Service（不允许 @Slf4j） | @Slf4j |

## 3. 异常处理

- 业务异常：throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR, "错误描述")
- 参数校验：throw new MycmBizException(ErrorCodeEnum.ILLEGAL_ARGUMENT, "参数错误")
- 系统异常：throw new MycmSysException(ErrorCodeEnum.SYSTEM_INNER_ERROR, "描述", e)
- 错误码使用 ErrorCodeEnum 枚举
- ErrorCodeEnum 常用值：BIZ_ERROR、ILLEGAL_ARGUMENT、SYSTEM_INNER_ERROR、DATA_IS_EMPTY、DATA_VALIDATE_ERROR
- 禁止：throw new RuntimeException()、throw new Exception()
- 禁止：空 catch 块
- 禁止：在 catch 中暴露异常堆栈信息

## 4. 事务规则

- 事务注解只用于 Application Service 层
- 写操作：@Transactional(rollbackFor = Exception.class)
- 读操作：@Transactional(readOnly = true)
- 禁止：在 Domain 层和 Facade 层使用 @Transactional
- 禁止：事务内调用外部系统（RPC/MQ）
- 禁止：嵌套事务

## 5. 命名规范

| 类型 | 命名模式 | 示例 |
|------|---------|------|
| Entity | {Business}Entity 或 {Business} | OrderEntity, Order |
| Aggregate Root | {Business}Aggregator | OrderAggregator |
| Repository 接口 | {Entity}Repository | OrderRepository |
| Repository 实现 | {Entity}RepositoryImpl | OrderRepositoryImpl |
| Domain Service | {Business}Service | OrderService |
| Facade(管理) | {Business}ManageFacade | OrderManageFacade |
| Facade(查询) | {Business}QueryFacade | OrderQueryFacade |
| Facade 实现 | {Business}ManageFacadeImpl | OrderManageFacadeImpl |
| Application Service | {Business}ManageService | OrderManageService |
| Command | {Business}{Action}Command | OrderCreateCommand |
| Query | {Business}Query | OrderListQuery |
| VO | {Business}VO | OrderDetailVO |
| DO | {Business}DO | OrderDO |
| Mapper | {Business}Mapper | OrderMapper |
| Convert | {Business}Convert | OrderConvert |
| Enum | {Business}StatusEnum | OrderStatusEnum |
| Scheduler | {Business}Scheduler | OrderScheduler |

### 方法命名 CRUD 模式

| 操作 | 命名模式 | 示例 |
|------|---------|------|
| 查询单个 | get{Entity} / findById | getOrder, findById |
| 查询列表 | list{Entity} / findByCondition | listOrders, findByCondition |
| 分页查询 | page{Entity} / listByPage | pageOrders |
| 新增 | save / create{Entity} | save, createOrder |
| 更新 | update{Entity} | updateStatus |
| 删除 | remove / delete{Entity} | remove (逻辑删除) |
| 统计 | count{Entity} | countByCondition |
| 判断 | is{Condition} / has{Condition} | isBlacklisted, hasPermission |

## 6. Facade 规范

- 返回值必须使用 Result\<T\> 包装
- 使用 BizTemplate.doProcess() 构建返回值（默认方式）
- 查询接口返回 Result\<Paginator\<T\>\> 分页
- 每个 Facade 方法必须有 @FacadeIntercept(loggerName = MycmLoggerDef.FACADE_SERVICE_LOGGER) 注解
- 禁止在 Facade 层处理业务逻辑

## 7. 外部集成

| 操作类型 | 超时时间 | 备注 |
|---------|---------|------|
| 查询 | 3000ms | SOFARPC 默认 |
| 写入 | 5000ms | - |
| 复杂操作 | 10000ms | - |
| 外部调用 | 15000ms | - |

- RPC 服务提供：Facade 实现使用 @RpcProvider 或 @SofaService
- RPC 服务消费：集中配置类中使用 @RpcConsumer(timeout = xxx)
- 集成客户端封装：FacadeClient 接口 + FacadeClientImpl（命名可按项目约定覆盖）
- 集成客户端日志：@SalLog(loggerName = LoggerDef.SAL_DETAIL_LOGGER)
- Mapper 调用日志：@DalLog
- 集成客户端必须做 Result 校验（Preconditions.checkNotNull + Preconditions.checkState）
- Preconditions 来源：Guava 或项目自定义工具类（由 project-conventions.md 确定）

## 8. 日志规范

| Logger 名称 | 使用层 | 用途 |
|------------|-------|------|
| MycmLoggerDef.FACADE_SERVICE_LOGGER | Facade | @FacadeIntercept 参数 |
| BIZ-SERVICE-LOGGER | Application | 业务日志 |
| LoggerDef.SAL_DETAIL_LOGGER | Integration | @SalLog 参数 |
| 领域层 | 禁止 | 不可使用日志 |

- 使用 @Slf4j（领域层除外）
- Facade 拦截：@FacadeIntercept(loggerName = MycmLoggerDef.FACADE_SERVICE_LOGGER)
- 集成调用：@SalLog(loggerName = LoggerDef.SAL_DETAIL_LOGGER)
- Mapper 调用：@DalLog
- 禁止在日志中记录敏感数据

## 9. 安全规范

- 输入校验：Assert.notNull(), Assert.hasText(), Assert.isTrue()
- SQL 注入：禁止字符串拼接 SQL，必须参数化查询
- 敏感数据：禁止日志记录，脱敏展示

## 10. 性能规范

- N+1 查询：使用 JOIN FETCH 或 @BatchSize
- 大对象：避免在循环中创建
- 同步阻塞：外部调用使用异步或超时控制

## 11. MapStruct Convert

- 使用 @Mapper（无 componentModel）
- 使用 INSTANCE 单例模式：`XxxConvert.INSTANCE = Mappers.getMapper(XxxConvert.class)`
- 调用方式：`XxxConvert.INSTANCE.toEntity(doObj)`
- 不使用 Spring 注入

## 12. 项目约定覆盖

以上默认值基于 7 个项目的统计分析。对于已有项目，`helmcode install` 会扫描代码并生成 `.claude/standards/project-conventions.md` 覆盖差异项。

可能需要覆盖的维度：
- DO 注解风格（@Data / @Getter@Setter / 纯手写）
- Facade RPC 注解（@RpcProvider / @SofaService）
- Facade Result 构建（BizTemplate / 手动式）
- 异常类名（MycmBizException / 项目自定义）
- 错误码枚举名（ErrorCodeEnum / 项目自定义）
- MapStruct 使用（INSTANCE / I / 不使用）
- 持久层框架（MyBatis XML / MyBatis-Plus）
- 集成客户端封装模式（FacadeClient / Adapter / 手写日志）
- Preconditions 来源（Guava / 项目自定义）
- Logger 常量定义
- ACTS Base Class 名称
- SOFABootTestApplication 位置
- dbmode 和 test_artifacts 配置
