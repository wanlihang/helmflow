# 包结构约定

`init-java-ddd` 生成的所有 Java 文件,必须落在下表指定的包路径中。审查 PR 时按本表对照。

> **核心原则**:按业务上下文(`{context}`)分包,不按技术关注分包。
> 一个功能点的 Facade + Acceptor + Handler + Action + Context 收敛在同一个 `{context}` 包下,
> AI coding 时 10 秒内定位到所有相关代码。

## 1. 模块 -> 顶层包前缀

| 模块            | 顶层包前缀                                     | 允许的 Spring 注解                                |
|---------------|--------------------------------------------|-----------------------------------------------|
| `bootstrap`   | `{basePackage}`                            | `@SpringBootApplication` 仅此一个类                |
| `web`         | `{basePackage}.web`                        | `@RestController`、`@ControllerAdvice`         |
| `application` | `{basePackage}.application`                | `@RpcProvider`、`@Component`、`@Configuration`  |
| `domain`      | `{basePackage}.domain`                     | `@Service`(领域服务),禁止持久化/HTTP 注解              |
| `infrastructure` | `{basePackage}.infrastructure`          | `@Repository`、`@Configuration`、`@Mapper`     |
| `facade`      | `{basePackage}.facade`                     | 禁止任何 Spring/SOFA 注解,只放 POJO + 接口            |

## 2. 子包细则

### 2.1 facade

```
{basePackage}.facade.<context>.Xxx{Facade}.java            <- 接口
{basePackage}.facade.<context>.model.command.XxxCommand    <- 写操作入参
{basePackage}.facade.<context>.model.query.XxxRequest      <- 查询入参
{basePackage}.facade.<context>.model.vo.XxxVO              <- 返回值
{basePackage}.facade.<context>.enums.XxxEnum               <- Facade 层枚举(仅接口专用)
```

- Request / Command 区分:Query 类用 Request,写操作用 Command;
- Command/Request 必须 `extends BaseRequest`(或显式标注 `@Valid`);
- VO 必须实现 `Serializable` 并写 `serialVersionUID`。
- `<context>` 按功能点命名,如 `accept`(受理)、`mapping`(产品映射)、`pricing`(价格配置)、`signing`(签约)、`query`(查询)、`callback`(回调)。

### 2.2 application

```
{basePackage}.application.<context>.facade.XxxFacadeImpl.java    <- @RpcProvider,Facade 实现
{basePackage}.application.<context>.acceptor.XxxAcceptor.java    <- 业务受理/前置校验
{basePackage}.application.<context>.handler.XxxHandler.java      <- HandlerTemplate/StatefulHandlerTemplate
{basePackage}.application.<context>.action.XxxAction.java        <- Action 原子动作
{basePackage}.application.<context>.context.XxxContext.java      <- HandlerContext 不可变上下文
{basePackage}.application.<context>.convert.XxxVoConvert.java    <- MapStruct,domain → VO
{basePackage}.application.<context>.event.XxxListener.java       <- 领域事件订阅
{basePackage}.application.<context>.service.XxxService.java      <- 应用服务(简单 CRUD 可省略此层)
{basePackage}.application.decider.XxxDecider.java                <- 跨功能点共享的决策/路由逻辑
{basePackage}.application.decider.XxxMode.java                   <- 决策结果枚举
{basePackage}.application.decider.XxxContext.java                <- 决策上下文
{basePackage}.application.shared.handler.HandlerTemplate.java    <- 线性处理基类
{basePackage}.application.shared.handler.StatefulHandlerTemplate.java <- 状态机处理基类
{basePackage}.application.shared.handler.Action.java             <- Action 接口
{basePackage}.application.shared.handler.OperateLogAction.java   <- 日志 Action(基类自动追加)
{basePackage}.application.shared.handler.HandlerContext.java     <- 上下文基类
{basePackage}.application.shared.handler.HandlerExceptionHandler.java <- 异常处理
```

- **Facade → Acceptor → Handler 三层调用链**:
  1. FacadeImpl 通过 BizTemplate.doProcess() 入口,内部调 Acceptor 校验;
  2. Acceptor 做参数校验、状态前置检查、权限判断;
  3. Handler 用 HandlerTemplate 编排 Action 顺序执行。
- **`decider/`** 是跨功能点共享的决策引擎(如签约模式路由),不属于任何单一功能点。
- **`shared/handler/`** 是横切基础设施(HandlerTemplate 基类 + Action 接口),全局复用。
- 简单 CRUD 场景可省略 Acceptor/Handler/Action/FacadeImpl,直接走 BizTemplate + Service。

### 2.3 domain

```
{basePackage}.domain.<context>.model.*Entity.java          <- 聚合根/实体
{basePackage}.domain.<context>.model.*Aggregator.java      <- 聚合根(含子实体)
{basePackage}.domain.<context>.model.valueobject.*.java    <- 值对象
{basePackage}.domain.<context>.model.event.*Event.java     <- 领域事件
{basePackage}.domain.<context>.query.*Query.java           <- 查询封装
{basePackage}.domain.<context>.repository.*Repository.java <- 仓储接口
{basePackage}.domain.<context>.service.*Service.java       <- 领域服务接口
{basePackage}.domain.<context>.service.impl.*ServiceImpl.java <- @Service
{basePackage}.domain.<context>.exception.*Exception.java   <- 业务异常
{basePackage}.domain.<context>.constant.*Constant.java     <- 常量
{basePackage}.domain.shared.valueobject.*.java             <- 跨子域共享值对象
```

- `<context>` 按子域命名,如 `deliver`(交付需求)、`pricing`(价格)、`signing`(签约)。
- `shared/` 放跨子域共享的值对象和常量,不放实体(实体必有归属子域)。
- 领域服务 `@Service` 禁止 `@Slf4j`(领域层不记日志)。
- 仓储接口定义在 domain 层,实现在 infrastructure 层(依赖倒置)。

### 2.4 infrastructure

```
{basePackage}.infrastructure.<context>.repository.*RepositoryImpl.java  <- @Repository,实现 domain 仓储
{basePackage}.infrastructure.<context>.mybatis.mapper.*DOMapper.java    <- @Mapper
{basePackage}.infrastructure.<context>.mybatis.model.*DO.java           <- MyBatis DO
{basePackage}.infrastructure.<context>.convert.*Convert.java            <- MapStruct,domain ↔ DO
{basePackage}.infrastructure.<context>.integration.*Client.java         <- 外部 RPC 客户端封装
{basePackage}.infrastructure.<context>.acl.*Acl.java                    <- 防腐层:翻译外部 DTO
{basePackage}.infrastructure.config.*Configuration.java                 <- @Configuration(全局共享)
{basePackage}.infrastructure.config.MybatisConfiguration.java           <- Mybatis 全局配置(扫描所有 mapper 包)
{basePackage}.infrastructure.log.MycmLoggerDef.java                     <- logger 名常量(全局共享)
{basePackage}.infrastructure.messaging.*EventPublisher.java             <- 领域事件发布(全局共享)
```

- `<context>` 与 facade/application/domain 保持一致,同一功能点的仓储、Mapper、DO、Convert 收敛在同一包下。
- `config/`、`log/`、`messaging/` 不带 `<context>` 前缀——这些是跨功能点共享的基础设施,不属于任何单一功能点。
- `MybatisConfiguration` 的 `@MapperScan` 需扫描 `{basePackage}.infrastructure` 下所有子包,
  确保 `<context>.mybatis.mapper` 都被识别。
- `acl/`(Anti-Corruption Layer)翻译外部 DTO 为领域内部模型,隔离外部系统变化。

### 2.5 bootstrap

```
{basePackage}.{AppName}Application.java     <- 唯一启动类
```

只放启动类。任何业务/配置类放进 bootstrap = 红线。

### 2.6 web

```
{basePackage}.web.<context>.XxxController.java    <- @RestController
```

Controller 按功能点分包,与 facade/application 的 `<context>` 对齐。

## 3. 包结构示例(以交付中枢为例)

```
app/
├── facade/                         # 接口层 — 按功能点分包
│   ├── accept/                    # 受理
│   │   ├── DeliveryAcceptFacade
│   │   └── model/command/
│   ├── mapping/                   # 产品映射
│   │   ├── ProdMappingFacade
│   │   └── model/command/
│   ├── pricing/                   # 价格配置
│   │   ├── PriceConfigFacade
│   │   └── model/command/
│   ├── signing/                   # 签约
│   │   ├── SigningFacade
│   │   └── model/command/
│   └── query/                     # 查询
│       ├── DeliveryQueryFacade
│       └── model/vo/
│
├── application/                   # 应用层 — Decider → Acceptor → Handler
│   ├── decider/                   # 签约模式决策(跨功能点共享)
│   │   ├── SignModeDecider
│   │   └── SignMode
│   ├── accept/                    # 受理功能点
│   │   ├── acceptor/DeliverRecordAcceptor
│   │   ├── handler/SaveDeliverRecordHandler
│   │   ├── action/SaveDeliverRecordAction
│   │   └── context/DeliverRecordContext
│   ├── mapping/                   # 产品映射功能点
│   │   ├── acceptor/ProdMappingAcceptor
│   │   ├── handler/ProductMappingSubmitHandler
│   │   ├── action/SavePdMappingAction
│   │   └── context/ProdMappingContext
│   ├── pricing/                   # 价格配置功能点
│   │   ├── acceptor/PriceConfigAcceptor
│   │   ├── handler/PriceApplyFirstStageHandler
│   │   ├── action/PriceApplyAction
│   │   └── context/PriceContext
│   ├── signing/                   # 签约功能点
│   │   ├── acceptor/SigningAcceptor
│   │   ├── handler/QtFusionAutoSignHandler
│   │   ├── action/CreateQtFusionDetailAndPriceAction
│   │   └── context/SigningContext
│   ├── blacklist/                 # Demo 切片
│   │   ├── facade/BlacklistManageFacadeImpl
│   │   └── convert/BlacklistVoConvert
│   └── shared/                    # 跨功能点复用基类
│       └── handler/
│           ├── HandlerTemplate
│           ├── StatefulHandlerTemplate
│           ├── Action
│           ├── OperateLogAction
│           └── HandlerContext
│
├── domain/                        # 领域层 — 按子域内聚分包
│   ├── core/                      # 聚合根 + 通用模型
│   │   ├── model/DeliverRecord
│   │   ├── model/DeliverRecordState
│   │   ├── repository/DeliverRecordRepository
│   │   └── service/DeliverRecordStatusService
│   ├── pricing/                   # 价格子域
│   │   ├── model/PriceInfo
│   │   ├── model/PriceCombo
│   │   └── service/PriceValidationService
│   ├── signing/                   # 签约子域
│   │   └── model/DeliverSignItem
│   └── blacklist/                 # Demo 切片
│       ├── model/EmailBlacklist
│       ├── repository/EmailBlacklistRepository
│       └── service/EmailBlacklistService
│
├── infrastructure/                # 基础设施层 — 按功能点 + 按技术分包
│   ├── blacklist/                 # Demo 切片
│   │   ├── repository/EmailBlacklistRepositoryImpl
│   │   ├── mybatis/mapper/EmailBlacklistDOMapper
│   │   ├── mybatis/model/EmailBlacklistDO
│   │   └── convert/EmailBlacklistConvert
│   ├── integration/               # 外部系统集成(跨功能点)
│   │   ├── ApprovalProcessClient
│   │   └── SignSystemClient
│   ├── config/                    # 全局 @Configuration(跨功能点)
│   │   ├── ZdalConfiguration
│   │   ├── MybatisConfiguration
│   │   └── SequenceConfiguration
│   └── log/                       # 全局日志常量(跨功能点)
│       └── MycmLoggerDef
```

## 4. 资源路径约定

| 路径                                        | 用途                                  |
|-------------------------------------------|-------------------------------------|
| `src/main/resources/spring/*.xml`         | SOFABoot Spring beans(可放空文件,但目录必须存在) |
| `src/main/resources/mapper/*.xml`         | MyBatis Mapper 映射                   |
| `src/main/resources/mapper/command/*.xml` | mycm-common 自带 command 模块 Mapper    |
| `src/main/resources/application*.properties` | 环境配置(snake_case for mist/antkms,dot for sofa.*) |
| `src/main/resources/log4j2-spring.xml`    | 日志配置(必须放在 bootstrap 模块)            |

## 5. 分包策略的核心约束

### 5.1 一条功能点的代码收敛在一个 {context} 包下

当 AI(或开发者)需要实现"产品映射审批通过"时,应该在一个 `mapping` 包下找到:
- mapping/handler/ — 编排逻辑
- mapping/action/ — 原子动作
- mapping/acceptor/ — 前置校验
- mapping/context/ — 上下文数据

而不是在 handler/、action/、acceptor/ 三个水平包之间跳来跳去。

### 5.2 跨功能点共享的放在顶层

只有满足以下条件之一的代码才能放在 `{module}/` 顶层(不带 `{context}`):
- 被两个以上 `{context}` 引用(如 `decider/`、`shared/handler/`)
- 技术基础设施,不属于业务(如 `config/`、`log/`、`messaging/`)
- 通用查询/异常转换(如 facade 层的 `shared/`)

### 5.3 infrastructure 的 {context} 与其他层对齐

同一功能点的 RepositoryImpl、Mapper、DO、Convert 必须在 `infrastructure.<context>` 下,
与 `domain.<context>` 和 `application.<context>` 一一对应。
`infrastructure.mybatis.MybatisConfiguration` 仍保留在全局 `config/`(扫描全部 mapper 子包)。