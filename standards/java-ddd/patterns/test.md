# Test Pattern

> When to use: Generate ACTS integration tests for Facade methods, and unit tests for Domain logic.
> 测试框架：ACTS（蚂蚁自动化组件测试）+ TestNG。JUnit 被显式排除（surefire 配置 junitArtifactName=none:none）。

## 测试类型选择

| 代码类型 | 测试类型 | 框架 | 模板 |
|---------|---------|------|------|
| FacadeImpl | ACTS 集成测试 | ACTS + TestNG | 见下方 ACTS 模板 |
| Application Service | ACTS 集成测试 | ACTS + TestNG | 同上 |
| Domain Entity / DomainService | 单元测试 | TestNG + Mockito | 见下方单元测试模板 |
| Repository | ACTS 集成测试 | ACTS + TestNG | 同上 |
| Convert / 工具类 | 单元测试 | TestNG | 见下方单元测试模板 |

---

## ACTS 集成测试模板（Facade 测试）

### 目录结构

```
src/test/java/com/xxx/acts/test/
  {facadeName}/
    {methodName}/
      {MethodName}ActsTest.java          # 测试类
      case01_success/                     # 场景1：正常路径
        caseObjs.yaml                     # 测试数据
        PrepareDBData/                    # 可选：DB 准备数据
          table_name.csv
        CheckDBData/                      # 可选：DB 校验数据
          table_name.csv
      case02_invalid_param/               # 场景2：参数校验
        caseObjs.yaml
      case03_dependency_fail/             # 场景3：依赖失败
        caseObjs.yaml
      case04_business_error/              # 场景4：业务规则错误
        caseObjs.yaml
      case05_edge_case/                   # 场景5：边界值
        caseObjs.yaml
```

### 项目级 Base Class（每项目一个）

```java
package {PACKAGE}.servicetest.base;

import com.alipay.test.acts.template.ActsTestBase;
import org.springframework.boot.test.context.SpringBootTest;
import java.util.ArrayList;
import java.util.List;

@SpringBootTest(classes = SOFABootTestApplication.class)
public class {ProjectName}ActsTestBase extends ActsTestBase {

    static {
        System.setProperty("test_artifacts", "commons-pool-,commons-beanutils-,acts-core-");
        System.setProperty("dbmode", "dev");
    }

    @Override
    public List<String> backFillSqlList() {
        return new ArrayList<>();
    }

    @Override
    public List<String> setIgnoreCheckFileds() {
        // 格式: "fully.qualified.ClassName#fieldName#flag"
        // N = 跳过校验, R = 正则匹配
        return new ArrayList<>();
    }
}
```

### ACTS 测试类模板

```java
package {PACKAGE}.acts.test.{facadeName}.{methodName};

import com.alipay.test.acts.annotation.TestBean;
import com.alipay.test.acts.annotation.acts.AutoFill;
import com.alipay.test.acts.annotation.acts.PrepareCase;
import com.alipay.test.acts.annotation.acts.RunOnly;
import com.alipay.test.acts.model.PrepareData;
import com.alipay.test.acts.runtime.ActsRuntimeContext;
import {PACKAGE}.servicetest.base.{ProjectName}ActsTestBase;
import org.testng.annotations.Test;

public class {MethodName}ActsTest extends {ProjectName}ActsTestBase {

    @TestBean
    protected {FacadeInterface} {facadeInterface};

    @Test(dataProvider = "ActsDataProvider")
    @AutoFill(overwrite = false, sqlList = {})
    @RunOnly(caseList = {".*"})
    public void {methodName}(String caseId, String desc, PrepareData prepareData) {
        runTest(caseId, prepareData);
    }

    @Override
    public void beforeActsTest(ActsRuntimeContext actsRuntimeContext) {
        super.beforeActsTest(actsRuntimeContext);
        // 全局 setup：mock 外部依赖
    }

    @PrepareCase(".*case01.*")
    public void p01(ActsRuntimeContext actsRuntimeContext) {
        // case01 专用准备逻辑
    }

    @PrepareCase(".*case03.*")
    public void p03(ActsRuntimeContext actsRuntimeContext) {
        // case03: mock 外部依赖抛异常
    }

    @Override
    public void afterActsTest(ActsRuntimeContext actsRuntimeContext) {
        super.afterActsTest(actsRuntimeContext);
        // 全局清理：还原 mock、清理测试数据
    }
}
```

### caseObjs.yaml 模板

```yaml
# Section 1: Case Desc
{场景描述}

---
# Section 2: Arguments: List<Object>
[
  !!{PACKAGE}.facade.request.{RequestType} {
    field1: 'value1',
    field2: 'value2'
  }
]

---
# Section 3: Flags: Map<String, Map<String, String>>
{
  {PACKAGE}.facade.response.{ResponseType}: {
    fieldName: N,
    otherField: Y
  }
}

---
# Section 4: Result: Object
!!com.mycm.common.model.base.Result {
  success: true,
  resultCode: '0000',
  resultMsg: success,
  data: !!{PACKAGE}.facade.response.{ResponseType} {
    field1: expectedValue
  }
}

---
# Section 5: Message Event: List<Map<String, Object>>
null

---
# Section 6: User-defined Params: Map<String, Object>
{
  key1: "value1"
}

---
# Section 7: Virtual Mocks(Deprecated): List<VirtualMock>
null
```

### Mock 方式（3 种，按优先级）

**方式 1：Mockito + ReflectionTestUtils（推荐）**

```java
{ClientType} mockClient = Mockito.mock({ClientType}.class);
ReflectionTestUtils.setField(targetService, "fieldName", mockClient);
Mockito.when(mockClient.{method}(Mockito.any())).thenReturn(result);
```

**方式 2：ACTS VirtualMock**

```java
VirtualMock vm = new VirtualMock(
    "parentBeanName",
    "fieldName",
    FieldClass.class,
    "methodName",
    returnValue,
    "description"
);
actsRuntimeContext.addVirtualMock(vm);
```

**方式 3：MockUtilsX（ATS 工具）**

```java
MockUtilsX.addMock(target, "fieldName", FieldType.class, "methodName");
MockUtilsX.recordMock(target, "fieldName", "methodName", returnValue);
```

---

## 单元测试模板（Domain / 工具类）

```java
package {PACKAGE}.unittest.{module};

import org.testng.Assert;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;
import org.mockito.Mockito;
import org.mockito.MockitoAnnotations;

public class {ClassName}Test {

    @BeforeMethod
    public void setUp() {
        MockitoAnnotations.openMocks(this);
    }

    // ==================== P0: 正常路径 ====================

    @Test
    public void test{MethodName}_Success() {
        // Given
        {InputType} input = build{InputType}();

        // When
        {ResultType} result = {target}.{methodName}(input);

        // Then
        Assert.assertNotNull(result);
        Assert.assertEquals(result.get{Field}(), expectedValue);
    }

    // ==================== P1: 边界值 ====================

    @Test
    public void test{MethodName}_EdgeCase_{Condition}() {
        // Given
        {InputType} input = build{InputType}();
        input.set{Field}({boundaryValue});

        // When & Then
        Assert.assertThrows({ExceptionType}.class, () -> {
            {target}.{methodName}(input);
        });
    }

    // ==================== P1: 参数校验 ====================

    @Test
    public void test{MethodName}_InvalidParam_{Param}Null() {
        // Given
        {InputType} input = build{InputType}();
        input.set{Param}(null);

        // When & Then
        Assert.assertThrows(IllegalArgumentException.class, () -> {
            {target}.{methodName}(input);
        });
    }

    // ==================== 辅助方法 ====================

    private {InputType} build{InputType}() {
        {InputType} input = new {InputType}();
        // 设置默认值
        return input;
    }
}
```

---

## PrepareDBData CSV 格式

```csv
"columnName","dataType","comment","primaryKey","nullable","flag","value"
"id","VARCHAR","primary key","true","false","C","${auto}"
"status","VARCHAR","状态","false","false","Y","INIT"
"gmt_create","TIMESTAMP","创建时间","false","false","Y",2024-09-22 17:22:44
```

flag 列值：C = 主键（用于清理），Y = 普通数据。

---

## 场景覆盖要求

每个 Facade 方法至少覆盖以下 ACTS case：

| case 编号 | 场景 | 必须 |
|-----------|------|------|
| case01 | 正常路径（Success） | 必须 |
| case02 | 参数校验失败 | 必须 |
| case03 | 外部依赖失败 | 必须 |
| case04 | 业务规则错误 | 必须 |
| case05 | 边界值 | 推荐 |
| case06+ | 其他业务场景 | 按需 |
