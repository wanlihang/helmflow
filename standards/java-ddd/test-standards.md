# Java Spring Boot DDD 测试标准

> 基于 7 个 SOFABoot 项目的实际测试模式分析建立。
> 测试框架：ACTS（蚂蚁自动化组件测试）+ TestNG。
> JUnit 被显式排除（surefire 配置 junitArtifactName=none:none）。

## 1. 覆盖率要求

| 层 | 行覆盖率 | 分支覆盖率 |
|---|---------|-----------|
| Facade | >= 85% | >= 75% |
| Service | >= 80% | >= 70% |
| Domain Logic | >= 90% | - |
| 总体 | >= 80% | >= 70% |

## 2. 测试类型选择

| 代码类型 | 测试类型 | 框架 | 测试位置 |
|---------|---------|------|---------|
| FacadeImpl | ACTS 集成测试 | ACTS + TestNG | app/test/ |
| Application Service | ACTS 集成测试 | ACTS + TestNG | app/test/ |
| Domain Entity | 单元测试 | TestNG + Mockito | app/test/ 或同模块 src/test/ |
| DomainService | 单元测试 | TestNG + Mockito | app/test/ 或同模块 src/test/ |
| Convert / 工具类 | 单元测试 | TestNG | 同模块 src/test/ |

## 3. ACTS 测试规范

### 3.1 测试类结构

- 每个 Facade 方法一个 ACTS 测试类：`{MethodName}ActsTest`
- 继承项目级 Base Class：`{ProjectName}ActsTestBase extends ActsTestBase`
- 使用 `@TestBean` 声明被测 Facade
- 使用 `@Test(dataProvider = "ActsDataProvider")` 声明测试方法
- 使用 `@AutoFill`、`@RunOnly` 控制执行行为
- 使用 `@PrepareCase` 处理特定 case 的准备逻辑

### 3.2 场景覆盖

每个 Facade 方法的 ACTS 测试至少包含以下 case：

| case 编号 | 场景 | 必须 |
|-----------|------|------|
| case01 | 正常路径（Success） | 必须 |
| case02 | 参数校验失败 | 必须 |
| case03 | 外部依赖失败 | 必须 |
| case04 | 业务规则错误 | 必须 |
| case05 | 边界值 | 推荐 |
| case06+ | 其他业务场景 | 按需 |

### 3.3 caseObjs.yaml 规范

- 文件位置：与测试类同包，`caseNN_description/caseObjs.yaml`
- 必须包含 7 个 section（用 `---` 分隔）：Case Desc、Arguments、Flags、Result、Message Event、User-defined Params、Virtual Mocks
- Arguments 和 Result 必须使用完整类名（`!!com.xxx.ClassName`）
- Flags 中 N = 跳过校验，Y = 校验

### 3.4 DB 数据准备

- PrepareDBData：CSV 格式，flag=C 表示主键（用于自动清理）
- CheckDBData：执行后期望的 DB 状态
- 主键字段必须提供，确保数据可清理

### 3.5 Mock 方式

优先使用 Mockito + ReflectionTestUtils：

```java
{ClientType} mockClient = Mockito.mock({ClientType}.class);
ReflectionTestUtils.setField(targetService, "fieldName", mockClient);
```

备选 ACTS VirtualMock 或 MockUtilsX。

Mock 清理在 `afterActsTest()` 中完成。

## 4. 单元测试规范（Domain / 工具类）

- 框架：TestNG（`org.testng.Assert`）+ Mockito
- 类命名：`{TargetClass}Test`
- 方法命名：`test{MethodName}_{Scenario}` 或 `test{MethodName}_{Scenario}_{Condition}`
- 禁止：`test1()`、`testDemo()`、缺少场景描述的方法名
- 每个测试方法只测一个场景
- 测试方法间必须独立，不依赖执行顺序

## 5. 边界值

| 类型 | 边界值 |
|------|--------|
| 数值 | 0, -1, MAX, MIN |
| 字符串 | 空串, 超长串, null |
| 集合 | 空, 单元素, 大集合 |
| 金额 | 0.01（最小单位）, 99999999.99（最大） |
| 时间 | 00:00:00, 23:59:59 |

## 6. 项目约定覆盖

以上默认值基于 7 个项目的统计分析。已有项目安装时，`helmcode install` 会扫描代码并生成 `project-conventions.md` 覆盖差异项。

可能需要覆盖的测试维度：
- ACTS base class 名称
- SOFABootTestApplication 位置
- dbmode 配置
- test_artifacts 排除列表
- Mock 方式偏好（Mockito vs VirtualMock vs MockUtilsX）

## 7. CI/CD 质量门禁

- ACTS 测试通过 mvn test (TestNG suite xml) 执行
- 覆盖率低于阈值构建失败
- 新增 Facade 方法必须同步新增 ACTS 测试
