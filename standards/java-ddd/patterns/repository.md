# Repository Pattern

> When to use: Define a Repository interface in the domain layer to provide collection-like access to aggregates/entities. The implementation lives in the infrastructure layer, bridging domain objects to persistence via DO (Data Object), Mapper, and Convert.
>
> **默认模板**使用 @Data（DO）和 MapStruct INSTANCE 单例。已有项目由 project-conventions.md 覆盖。

## Repository Interface (Domain Layer)

```java
package {PACKAGE}.domain.{MODULE}.repository;

import {PACKAGE}.domain.{MODULE}.model.{Business}Entity;
import {PACKAGE}.domain.{MODULE}.model.{Business}Aggregator;
import {PACKAGE}.domain.{MODULE}.model.{Business}Item;

import java.util.List;

/**
 * {Business} repository interface — defined in the domain layer.
 * Implementations reside in the infrastructure layer (dependency inversion).
 */
public interface {Business}Repository {

    /**
     * Find entity by id.
     */
    {Business}Entity findById(Long id);

    /**
     * Find entity by business number.
     */
    {Business}Entity findBy{Business}No(String {business}No);

    /**
     * Save (insert or update) entity.
     */
    {Business}Entity save({Business}Entity entity);

    /**
     * Find aggregate root by id (with child items).
     */
    {Business}Aggregator findAggregatorById(Long id);

    /**
     * Save aggregate root (with child items).
     */
    {Business}Aggregator saveAggregator({Business}Aggregator aggregator);

    /**
     * Find child items by {business} id.
     */
    List<{Business}Item> findItemsBy{Business}Id(Long {business}Id);
}
```

## DO (Data Object) — 默认模板

- **不继承基类**
- **默认使用 @Data**
- 审计字段（id, gmtCreate, gmtModified, creator, modifier）直接声明

```java
package {PACKAGE}.infrastructure.{MODULE}.dataobject;

import lombok.Data;
import java.io.Serializable;
import java.util.Date;

@Data
public class {Business}DO implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long id;
    private Date gmtCreate;
    private Date gmtModified;
    private String creator;
    private String modifier;

    private String {business}No;
    private String type;
    private String status;
    private Long amount;
    private String currency;
    private String remark;
    private Long version;
}
```

> **项目覆盖**: 已有项目可能使用 @Getter + @Setter 或纯手写。由 project-conventions.md 确定。

### 备选: @Getter + @Setter

```java
package {PACKAGE}.infrastructure.{MODULE}.dataobject;

import lombok.Getter;
import lombok.Setter;
import java.io.Serializable;
import java.util.Date;

@Getter
@Setter
public class {Business}DO implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long id;
    private Date gmtCreate;
    private Date gmtModified;
    private String creator;
    private String modifier;

    private String {business}No;
    private String type;
    private String status;
    private Long amount;
    private String currency;
    private String remark;
    private Long version;
}
```

### 备选: 纯手写（无 Lombok）

```java
package {PACKAGE}.infrastructure.{MODULE}.dataobject;

import java.io.Serializable;
import java.util.Date;

public class {Business}DO implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long id;
    private Date gmtCreate;
    private Date gmtModified;
    private String creator;
    private String modifier;

    private String {business}No;
    private String type;
    private String status;
    private Long amount;
    private String currency;
    private String remark;
    private Long version;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    // ... getter/setter for each field
}
```

> **项目约定覆盖**: 安装时扫描项目 DO 文件，自动检测使用哪种变体。

## Mapper (MyBatis)

```java
package {PACKAGE}.infrastructure.{MODULE}.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import {PACKAGE}.infrastructure.{MODULE}.dataobject.{Business}DO;
import {PACKAGE}.infrastructure.{MODULE}.dataobject.{Business}ItemDO;

import java.util.List;

/**
 * MyBatis mapper for {Business}DO.
 * Use @Mapper annotation.
 */
@Mapper
public interface {Business}Mapper {

    int insert({Business}DO record);

    int updateById({Business}DO record);

    {Business}DO selectById(@Param("id") Long id);

    {Business}DO selectBy{Business}No(@Param("{business}No") String {business}No);

    List<{Business}DO> selectByCondition(@Param("status") String status,
                                          @Param("type") String type);
}
```

```java
package {PACKAGE}.infrastructure.{MODULE}.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import {PACKAGE}.infrastructure.{MODULE}.dataobject.{Business}ItemDO;

import java.util.List;

/**
 * MyBatis mapper for {Business}ItemDO.
 */
@Mapper
public interface {Business}ItemMapper {

    int batchInsert(@Param("list") List<{Business}ItemDO> list);

    int updateById({Business}ItemDO record);

    int deleteBy{Business}Id(@Param("{business}Id") Long {business}Id);

    List<{Business}ItemDO> selectBy{Business}Id(@Param("{business}Id") Long {business}Id);

    {Business}ItemDO selectById(@Param("id") Long id);
}
```

## Convert（DO ↔ Entity 转换）— 默认模板

> **默认使用 MapStruct INSTANCE 单例**。已有项目由 project-conventions.md 确定。

```java
package {PACKAGE}.infrastructure.{MODULE}.convert;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.factory.Mappers;
import {PACKAGE}.domain.{MODULE}.model.{Business}Entity;
import {PACKAGE}.domain.{MODULE}.model.{Business}Item;
import {PACKAGE}.infrastructure.{MODULE}.dataobject.{Business}DO;
import {PACKAGE}.infrastructure.{MODULE}.dataobject.{Business}ItemDO;

import java.util.List;

@Mapper
public interface {Business}Convert {

    {Business}Convert INSTANCE = Mappers.getMapper({Business}Convert.class);

    @Mapping(target = "id", source = "id")
    @Mapping(target = "{business}No", source = "{business}No")
    @Mapping(target = "status", source = "status")
    {Business}DO toDO({Business}Entity entity);

    @Mapping(target = "id", source = "id")
    @Mapping(target = "{business}No", source = "{business}No")
    @Mapping(target = "status", source = "status")
    {Business}Entity toEntity({Business}DO doObj);

    List<{Business}Entity> toEntityList(List<{Business}DO> doList);

    @Mapping(target = "{business}Id", source = "{business}Id")
    {Business}ItemDO toItemDO({Business}Item item);

    @Mapping(target = "{business}Id", source = "{business}Id")
    {Business}Item toItem({Business}ItemDO doObj);

    List<{Business}ItemDO> toItemDOList(List<{Business}Item> items);

    List<{Business}Item> toItemEntityList(List<{Business}ItemDO> doList);
}
```

### 备选: MapStruct I 单例

```java
@Mapper
public interface {Business}Convert {

    {Business}Convert I = Mappers.getMapper({Business}Convert.class);

    // 同变体 A 的方法
}
```

### 备选: 手写转换（无 MapStruct）

```java
package {PACKAGE}.infrastructure.{MODULE}.convert;

import {PACKAGE}.domain.{MODULE}.model.{Business}Entity;
import {PACKAGE}.infrastructure.{MODULE}.dataobject.{Business}DO;

public class {Business}Convert {

    public static {Business}DO toDO({Business}Entity entity) {
        if (entity == null) { return null; }
        {Business}DO doObj = new {Business}DO();
        doObj.setId(entity.getId());
        doObj.set{Business}No(entity.get{Business}No());
        doObj.setStatus(entity.getStatus().getCode());
        doObj.setRemark(entity.getRemark());
        doObj.setVersion(entity.getVersion());
        return doObj;
    }

    public static {Business}Entity toEntity({Business}DO doObj) {
        if (doObj == null) { return null; }
        {Business}Entity entity = new {Business}Entity();
        entity.setId(doObj.getId());
        entity.set{Business}No(doObj.get{Business}No());
        entity.setStatus({Business}StatusEnum.fromCode(doObj.getStatus()));
        entity.setRemark(doObj.getRemark());
        entity.setVersion(doObj.getVersion());
        return entity;
    }
}
```

> **项目约定覆盖**: 安装时扫描项目，检测 MapStruct 使用方式和字段名（INSTANCE 或 I）。

## RepositoryImpl (Infrastructure Layer)

```java
package {PACKAGE}.infrastructure.{MODULE}.repository;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;
import org.springframework.util.Assert;
import {PACKAGE}.domain.{MODULE}.model.{Business}Entity;
import {PACKAGE}.domain.{MODULE}.model.{Business}Aggregator;
import {PACKAGE}.domain.{MODULE}.model.{Business}Item;
import {PACKAGE}.domain.{MODULE}.model.{Business}StatusEnum;
import {PACKAGE}.domain.{MODULE}.repository.{Business}Repository;
import {PACKAGE}.infrastructure.{MODULE}.dataobject.{Business}DO;
import {PACKAGE}.infrastructure.{MODULE}.dataobject.{Business}ItemDO;
import {PACKAGE}.infrastructure.{MODULE}.mapper.{Business}Mapper;
import {PACKAGE}.infrastructure.{MODULE}.mapper.{Business}ItemMapper;
import {PACKAGE}.infrastructure.{MODULE}.convert.{Business}Convert;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.MycmSysException;
import com.mycm.common.model.exception.ErrorCodeEnum;

import java.util.List;

/**
 * {Business} repository implementation — lives in the infrastructure layer.
 * Uses @Repository annotation. Converts between domain model and DO via INSTANCE singleton.
 */
@Slf4j
@Repository
public class {Business}RepositoryImpl implements {Business}Repository {

    @Autowired
    private {Business}Mapper {business}Mapper;

    @Autowired
    private {Business}ItemMapper {business}ItemMapper;

    @Override
    public {Business}Entity findById(Long id) {
        Assert.notNull(id, "id must not be null");
        {Business}DO doObj = {business}Mapper.selectById(id);
        return doObj != null ? {Business}Convert.INSTANCE.toEntity(doObj) : null;
    }

    @Override
    public {Business}Entity findBy{Business}No(String {business}No) {
        Assert.hasText({business}No, "{business}No must not be empty");
        {Business}DO doObj = {business}Mapper.selectBy{Business}No({business}No);
        return doObj != null ? {Business}Convert.INSTANCE.toEntity(doObj) : null;
    }

    @Override
    public {Business}Entity save({Business}Entity entity) {
        Assert.notNull(entity, "entity must not be null");
        try {
            {Business}DO doObj = {Business}Convert.INSTANCE.toDO(entity);
            if (entity.getId() == null) {
                {business}Mapper.insert(doObj);
                entity.setId(doObj.getId());
            } else {
                int rows = {business}Mapper.updateById(doObj);
                if (rows == 0) {
                    throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                        "Optimistic lock conflict for {business} id=" + entity.getId());
                }
            }
            return entity;
        } catch (MycmBizException e) {
            throw e;
        } catch (Exception e) {
            throw new MycmSysException(ErrorCodeEnum.SYSTEM_INNER_ERROR, "Failed to save {business}", e);
        }
    }

    @Override
    public {Business}Aggregator findAggregatorById(Long id) {
        Assert.notNull(id, "id must not be null");
        {Business}DO doObj = {business}Mapper.selectById(id);
        if (doObj == null) {
            return null;
        }
        {Business}Aggregator aggregator = new {Business}Aggregator();
        aggregator.setId(doObj.getId());
        aggregator.set{Business}No(doObj.get{Business}No());
        aggregator.setStatus({Business}StatusEnum.fromCode(doObj.getStatus()));
        aggregator.setRemark(doObj.getRemark());
        aggregator.setVersion(doObj.getVersion());
        List<{Business}ItemDO> itemDOs = {business}ItemMapper.selectBy{Business}Id(id);
        aggregator.setItems({Business}Convert.INSTANCE.toItemEntityList(itemDOs));
        return aggregator;
    }

    @Override
    public {Business}Aggregator saveAggregator({Business}Aggregator aggregator) {
        Assert.notNull(aggregator, "aggregator must not be null");
        try {
            {Business}DO doObj = new {Business}DO();
            doObj.setId(aggregator.getId());
            doObj.set{Business}No(aggregator.get{Business}No());
            doObj.setStatus(aggregator.getStatus().getCode());
            doObj.setRemark(aggregator.getRemark());
            doObj.setVersion(aggregator.getVersion());

            if (aggregator.getId() == null) {
                {business}Mapper.insert(doObj);
                aggregator.setId(doObj.getId());
            } else {
                int rows = {business}Mapper.updateById(doObj);
                if (rows == 0) {
                    throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                        "Optimistic lock conflict for {business} id=" + aggregator.getId());
                }
            }

            // Save child items: delete-then-insert strategy
            {business}ItemMapper.deleteBy{Business}Id(aggregator.getId());
            List<{Business}ItemDO> itemDOs = {Business}Convert.INSTANCE.toItemDOList(aggregator.getItems());
            for ({Business}ItemDO itemDO : itemDOs) {
                itemDO.set{Business}Id(aggregator.getId());
            }
            if (!itemDOs.isEmpty()) {
                {business}ItemMapper.batchInsert(itemDOs);
            }

            return aggregator;
        } catch (MycmBizException e) {
            throw e;
        } catch (Exception e) {
            throw new MycmSysException(ErrorCodeEnum.SYSTEM_INNER_ERROR, "Failed to save {business} aggregate", e);
        }
    }

    @Override
    public List<{Business}Item> findItemsBy{Business}Id(Long {business}Id) {
        Assert.notNull({business}Id, "{business}Id must not be null");
        List<{Business}ItemDO> itemDOs = {business}ItemMapper.selectBy{Business}Id({business}Id);
        return {Business}Convert.INSTANCE.toItemEntityList(itemDOs);
    }
}
```

## Mapper XML Template

> 位置: `app/infrastructure/src/main/resources/mapper/{Business}DOMapper.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="{PACKAGE}.infrastructure.mybatis.mapper.{Business}DOMapper">

    <!-- 基础ResultMap -->
    <resultMap id="BaseResultMap" type="{PACKAGE}.infrastructure.mybatis.model.{Business}DO">
        <id column="id" property="id" jdbcType="BIGINT"/>
        <result column="gmt_create" property="gmtCreate" jdbcType="TIMESTAMP"/>
        <result column="gmt_modified" property="gmtModified" jdbcType="TIMESTAMP"/>
        <result column="creator" property="creator" jdbcType="VARCHAR"/>
        <result column="modifier" property="modifier" jdbcType="VARCHAR"/>
        <!-- 业务字段 -->
        <result column="{snake_field}" property="{camelField}" jdbcType="VARCHAR"/>
    </resultMap>

    <!-- 基础Column列表 -->
    <sql id="Base_Column_List">
        id, gmt_create, gmt_modified, creator, modifier, {snake_business_columns}
    </sql>

    <!-- 按主键查询 -->
    <select id="selectByPrimaryKey" resultMap="BaseResultMap">
        SELECT <include refid="Base_Column_List"/>
        FROM {table_name}
        WHERE deleted_id = 0
          AND id = #{id}
    </select>

    <!-- 按条件分页查询 -->
    <select id="selectByPage" resultMap="BaseResultMap">
        SELECT <include refid="Base_Column_List"/>
        FROM {table_name}
        WHERE deleted_id = 0
        <if test="{conditionField} != null and {conditionField} != ''">
            AND {snake_field} LIKE CONCAT('%', #{${conditionField}}, '%')
        </if>
        ORDER BY gmt_create DESC, id DESC
        LIMIT #{offset}, #{pageSize}
    </select>

    <!-- 按条件统计 -->
    <select id="countByCondition" resultType="long">
        SELECT COUNT(1)
        FROM {table_name}
        WHERE deleted_id = 0
        <if test="{conditionField} != null and {conditionField} != ''">
            AND {snake_field} LIKE CONCAT('%', #{${conditionField}}, '%')
        </if>
    </select>

    <!-- 插入 -->
    <insert id="insert" parameterType="{PACKAGE}.infrastructure.mybatis.model.{Business}DO"
            useGeneratedKeys="true" keyProperty="id" keyColumn="id">
        INSERT INTO {table_name} (
            gmt_create, gmt_modified, creator, modifier, deleted_id, {snake_business_columns}
        ) VALUES (
            NOW(), NOW(), #{creator}, #{modifier}, 0, #{camelBusinessValues}
        )
    </insert>

    <!-- 批量插入 -->
    <insert id="insertBatch" parameterType="list" useGeneratedKeys="true" keyProperty="id" keyColumn="id">
        INSERT INTO {table_name} (
            gmt_create, gmt_modified, creator, modifier, deleted_id, {snake_business_columns}
        ) VALUES
        <foreach collection="records" item="item" separator=",">
            (NOW(), NOW(), #{item.creator}, #{item.modifier}, 0, #{item.camelBusinessValues})
        </foreach>
    </insert>

    <!-- 逻辑删除 -->
    <update id="logicalDelete">
        UPDATE {table_name}
        SET gmt_modified = NOW(),
            modifier     = #{modifier},
            deleted_id   = id
        WHERE id = #{id}
    </update>

</mapper>
```