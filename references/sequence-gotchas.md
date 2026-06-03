# ZDAL Sequence 速查 (单库单表)

> 来源: [ZDAL Sequence 使用手册](https://yuque.antfin.com/middleware/zdal/sequence-manual)
> 本文档仅覆盖单库单表场景。分库分表 / DBMesh 模式请参阅原文档。

## 1. 核心概念

ZDAL Sequence 基于数据库号段算法:
1. 以步长 (step) 为单位，一次从数据库获取一段序列号范围 (Range)，缓存在本地
2. 应用内递增使用，用尽后再次从数据库获取下一个 Range
3. 获取 Range 时采用乐观锁，多节点冲突时自动重试 (retryTimes)

## 2. 规则表达式 (Rule)

格式: `{length(fieldName)=len}`，多个子规则拼接。

### 内置字段 (单库单表)

| 字段 | 说明 | 示例 |
|------|------|------|
| `sequenceValue` | 原始序列号 | `00103057` |
| `systemDate` | 获取 Range 时的日期(非实时) | `20260602` |

> 分库分表场景额外字段: `dbId`(分库路由)、`tableId`(分表路由)、`eDSID`(弹性位)，单库单表不使用。

### 常见规则

| 规则名 | 表达式 | 结果位数 | 示例 | 日容量 |
|--------|--------|----------|------|--------|
| DEFAULT(内置) | `{length(sequenceValue)=8}` | 8 | `00103057` | 1 亿 |
| SIMPLE | `{length(systemDate)=8}{length(sequenceValue)=8}` | 16 | `2026060200103057` | 1 亿 |

## 3. Bean 属性

| 属性 | 说明 | 默认值 |
|------|------|--------|
| `dataSource` | Sequence 表对应的 ZDAL DataSource Bean | — |
| `tableName` | Sequence 表名 | — |
| `minValue` | 序列最小值 | 1 |
| `maxValue` | 序列最大值 | 99999999 |
| `step` | 一次获取的号段大小 | 1000 |
| `retryTimes` | 乐观锁冲突重试次数 | — |
| `rules` | 序列号组装规则 Map | — |

> ⚠️ **重要**: 一个 Sequence Bean 对应一张 Sequence 表，不是某个具体序列。
> `minValue`/`maxValue`/`step` 仅在首次使用某 sequenceName 自动插入数据库行时生效，
> 后续修改这些参数需直接改数据库行，修改 Bean 属性不会生效。

## 4. API 速查

```java
// 获取序列号 (单库单表)
SequenceResult getNextValue(String sequenceName, String ruleName) throws DataAccessException;

// 获取精确服务端日期 (通过 SQL current_timestamp())
Date getSystemDate(String sequenceName) throws DataAccessException;

// 获取精确服务端时间 (通过 SQL current_timestamp())
Timestamp getSystemTimestamp(String sequenceName) throws DataAccessException;
```

### 用法示例

```java
@Autowired
@Qualifier("zdalSingleSequence")
private ZdalSequence zdalSingleSequence;

// DEFAULT 规则: 8 位序列号，如 "00103057"
String id = zdalSingleSequence.getNextValue("order_sequence", "DEFAULT").getSequenceValue();

// SIMPLE 规则: 16 位(日期+序列号)，如 "2026060200103057"
String id = zdalSingleSequence.getNextValue("order_sequence", "SIMPLE").getSequenceValue();
```

## 5. 关键约束 (Gotchas)

### 5.1 systemDate 非实时

`systemDate` 是获取 Sequence Range 时的日期，**不是**调用 `getNextValue()` 时的实时日期。
零点过后，systemDate 可能滞后 1 天，直到本地号段用尽、重新获取 Range 时才更新。
需要精确日期请使用 `getSystemDate()` / `getSystemTimestamp()`。

### 5.2 length 不截断

规则表达式 `{length(sequenceValue)=8}` 中的 length 只会**左补 0** 对齐到 8 位，
**不会截断**超长值。若 maxValue 配置为 `99999999`（8 个 9），但 sequenceValue 长度取 6，
当值达到 `1000000`（7 位）时，结果为 `1000000` 而非截断为 `000000`。
**务必确保 maxValue 与 sequenceValue 位数匹配**。

### 5.3 缓存过期与重复风险

- Sequence 缓存段采取 **24+1 小时随机过期**策略
- 开启预取开关后，过期时间可能延长到 **50 小时**
- 如果序列值 24h 内不循环，但在 50h 内循环，**可能出现重复**
- 建议根据业务增速合理设置 maxValue，确保不触发循环

### 5.4 参数修改走 DB

首次 `getNextValue("xxx", ...)` 时 ZDAL 自动在 Sequence 表中插入一行。
后续修改该序列的 minValue/maxValue/step，必须**直接修改数据库行**，
修改 SequenceConfiguration Bean 的属性**不会**生效。

### 5.5 Sequence 表必须有唯一索引

`name` 字段上必须建唯一索引 (`UNIQUE KEY`)，这是乐观锁机制的前提。