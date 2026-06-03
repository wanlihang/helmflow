# Builder Pattern

> When to use: Apply the Builder pattern when an object has many required/optional fields or complex construction logic. Use a manual Builder for objects requiring validation at build time; use Lombok `@Builder` for simple data-carrier objects; use an AggregatorBuilder `@Component` when construction involves repository lookups or external data.

## Manual Builder with Validation in build()

```java
package {PACKAGE}.domain.{MODULE}.model;

import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;
import org.springframework.util.Assert;

/**
 * Manual Builder for {Business}Entity with validation in build().
 * Use when construction requires invariants that Lombok @Builder cannot enforce.
 */
@Getter
@Setter
public class {Business}Entity {

    // --- Fields ---
    private Long id;
    private String {business}No;
    private String type;
    private String status;
    private {Business}Amount amount;
    private String remark;
    private Long version;

    // --- Private constructor — use Builder only ---
    private {Business}Entity() {}

    // --- Builder ---
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {

        private Long id;
        private String {business}No;
        private String type;
        private String status;
        private {Business}Amount amount;
        private String remark;
        private Long version;

        public Builder id(Long id) {
            this.id = id;
            return this;
        }

        public Builder {business}No(String {business}No) {
            this.{business}No = {business}No;
            return this;
        }

        public Builder type(String type) {
            this.type = type;
            return this;
        }

        public Builder status(String status) {
            this.status = status;
            return this;
        }

        public Builder amount({Business}Amount amount) {
            this.amount = amount;
            return this;
        }

        public Builder remark(String remark) {
            this.remark = remark;
            return this;
        }

        public Builder version(Long version) {
            this.version = version;
            return this;
        }

        /**
         * Build with validation. All required fields are checked here.
         */
        public {Business}Entity build() {
            Assert.hasText(this.{business}No, "{business}No is required");
            Assert.hasText(this.type, "type is required");
            Assert.notNull(this.amount, "amount is required");

            {Business}Entity entity = new {Business}Entity();
            entity.id = this.id;
            entity.{business}No = this.{business}No;
            entity.type = this.type;
            entity.status = this.status != null ? this.status : "I";
            entity.amount = this.amount;
            entity.remark = this.remark;
            entity.version = this.version != null ? this.version : 0L;
            return entity;
        }
    }
}

// --- Usage ---
// {Business}Entity entity = {Business}Entity.builder()
//     .{business}No("ORD-001")
//     .type("STANDARD")
//     .amount(new {Business}Amount(BigDecimal.TEN, "CNY"))
//     .remark("Created via builder")
//     .build();
```

## Lombok @Builder Variant (Simple Cases)

```java
package {PACKAGE}.facade.{MODULE}.model.vo;

import lombok.Builder;
import lombok.Data;
import java.io.Serializable;

/**
 * Simple VO with Lombok @Builder. Use for data-carrier objects
 * that do NOT require custom validation at build time.
 */
@Data
@Builder
public class {Business}SummaryVO implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long id;
    private String {business}No;
    private String type;
    private String status;
    private String statusDescription;
    private Long totalAmount;
    private String currency;
    private Integer itemCount;
}

// --- Usage ---
// {Business}SummaryVO vo = {Business}SummaryVO.builder()
//     .id(1L)
//     .{business}No("ORD-001")
//     .type("STANDARD")
//     .status("C")
//     .statusDescription("Completed")
//     .totalAmount(10000L)
//     .currency("CNY")
//     .itemCount(3)
//     .build();
```

## AggregatorBuilder @Component (Complex Construction)

```java
package {PACKAGE}.application.{MODULE}.builder;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import {PACKAGE}.domain.{MODULE}.model.{Business}Aggregator;
import {PACKAGE}.domain.{MODULE}.model.{Business}Item;
import {PACKAGE}.domain.{MODULE}.model.{Business}Amount;
import {PACKAGE}.domain.{MODULE}.repository.{Business}Repository;
import {PACKAGE}.domain.{MODULE}.model.{Business}StatusEnum;
import {PACKAGE}.facade.{MODULE}.model.command.{Business}CreateCommand;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;
import org.springframework.util.Assert;

import java.util.List;
import java.util.stream.Collectors;

/**
 * AggregatorBuilder assembles complex aggregates from multiple data sources.
 * A @Component because it may call repositories or other services to gather data.
 * NOT in the domain layer — this lives in the application layer.
 */
@Slf4j
@Component
public class {Business}AggregatorBuilder {

    @Autowired
    private {Business}Repository {business}Repository;

    /**
     * Build a new {Business}Aggregator from a create command.
     * Converts facade command into domain objects, applying defaults and validation.
     */
    public {Business}Aggregator buildFromCommand({Business}CreateCommand command) {
        Assert.notNull(command, "command must not be null");
        Assert.hasText(command.get{Business}No(), "{business}No is required");

        // Build items from command
        List<{Business}Item> items = command.getItems().stream()
            .map(itemCmd -> {Business}Item.create(
                itemCmd.getProductCode(),
                itemCmd.getQuantity(),
                new {Business}Amount(itemCmd.getUnitAmount(), command.getCurrency())
            ))
            .collect(Collectors.toList());

        // Build aggregate using factory method
        {Business}Aggregator aggregator = {Business}Aggregator.create(
            command.get{Business}No(),
            items,
            command.getRemark()
        );

        log.info("BIZ-SERVICE-LOGGER|{Business}AggregatorBuilt|{business}No={}|items={}",
            command.get{Business}No(), items.size());

        return aggregator;
    }

    /**
     * Re-constitute an aggregate from persistence.
     * Loads root + child entities and reassembles the aggregate.
     */
    public {Business}Aggregator rebuildFromPersistence(Long {business}Id) {
        Assert.notNull({business}Id, "{business}Id must not be null");

        // Load root
        {Business}Aggregator aggregator = {business}Repository.findById({business}Id);
        if (aggregator == null) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "{Business} not found: " + {business}Id);
        }

        // Load child items
        List<{Business}Item> items = {business}Repository.findItemsBy{Business}Id({business}Id);
        aggregator.setItems(items);

        log.info("BIZ-SERVICE-LOGGER|{Business}AggregatorRebuilt|id={}|items={}",
            {business}Id, items.size());

        return aggregator;
    }
}
```