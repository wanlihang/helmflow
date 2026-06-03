# Aggregate Root Pattern

> When to use: Define an Aggregate Root when a set of entities must maintain consistency boundaries together. The Aggregate Root is the only entry point for modifications; child entities are never modified independently.

## Aggregate Root with Child Entities

```java
package {PACKAGE}.domain.{MODULE}.model;

import lombok.Getter;
import lombok.Setter;
import {PACKAGE}.domain.{MODULE}.model.{Business}StatusEnum;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;
import org.springframework.util.Assert;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * {Business} Aggregate Root.
 * Owns child {Business}Item entities. All modifications go through this root.
 * Use @Getter + @Setter only (never @Data on aggregate roots).
 */
@Getter
@Setter
public class {Business}Aggregator {

    private Long id;
    private String {business}No;
    private {Business}StatusEnum status;
    private String remark;
    private Long version;

    /** Child entities — managed by the aggregate root only. */
    private List<{Business}Item> items = new ArrayList<>();

    // ---------- Factory Method ----------

    /**
     * Create a new {business} aggregate with at least one item.
     */
    public static {Business}Aggregator create(String {business}No,
                                                List<{Business}Item> items,
                                                String remark) {
        Assert.hasText({business}No, "{business}No must not be empty");
        Assert.notEmpty(items, "At least one item is required");

        {Business}Aggregator agg = new {Business}Aggregator();
        agg.set{Business}No({business}No);
        agg.setStatus({Business}StatusEnum.INIT);
        agg.setItems(new ArrayList<>(items));
        agg.setRemark(remark);
        agg.setVersion(0L);
        return agg;
    }

    // ---------- Domain Methods (Consistency Boundaries) ----------

    /**
     * Add an item. Domain rule: cannot add items after submission.
     */
    public void addItem({Business}Item item) {
        Assert.notNull(item, "item must not be null");
        if (this.status.isTerminal()) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Cannot add items to {business} in status: " + this.status.getCode());
        }
        this.items.add(item);
    }

    /**
     * Remove an item by id. Domain rule: must keep at least one item.
     */
    public void removeItem(Long itemId) {
        Assert.notNull(itemId, "itemId must not be null");
        if (this.status.isTerminal()) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Cannot remove items from {business} in status: " + this.status.getCode());
        }
        boolean removed = this.items.removeIf(item -> item.getId().equals(itemId));
        if (!removed) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Item not found: " + itemId);
        }
        if (this.items.isEmpty()) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "At least one item is required");
        }
    }

    /**
     * Submit the {business} for processing. Domain rule: only INIT can submit.
     */
    public void submit() {
        if (this.status != {Business}StatusEnum.INIT) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Cannot submit from status: " + this.status.getCode());
        }
        validateItems();
        this.status = {Business}StatusEnum.PROCESSING;
    }

    /**
     * Complete the {business}. Domain rule: only PROCESSING can complete.
     */
    public void complete() {
        if (this.status != {Business}StatusEnum.PROCESSING) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Cannot complete from status: " + this.status.getCode());
        }
        this.status = {Business}StatusEnum.COMPLETED;
    }

    /**
     * Cancel the {business}. Domain rule: terminal states cannot be cancelled.
     */
    public void cancel(String reason) {
        Assert.hasText(reason, "Cancel reason must not be empty");
        if (this.status.isTerminal()) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Cannot cancel from terminal status: " + this.status.getCode());
        }
        this.status = {Business}StatusEnum.CANCELLED;
        this.remark = reason;
    }

    // ---------- Derived State ----------

    /**
     * Calculate total amount from all items.
     */
    public {Business}Amount calculateTotalAmount() {
        return items.stream()
            .map({Business}Item::getAmount)
            .reduce({Business}Amount::add)
            .orElseThrow(() -> new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "No items to calculate total"));
    }

    /**
     * Read-only view of items. External code cannot mutate the list directly.
     */
    public List<{Business}Item> getItems() {
        return Collections.unmodifiableList(this.items);
    }

    // ---------- Internal Validation ----------

    private void validateItems() {
        for ({Business}Item item : this.items) {
            item.validateState();
        }
    }

    /**
     * Validate aggregate state before persistence.
     */
    public void validateState() {
        Assert.hasText(this.{business}No, "{business}No must not be empty");
        Assert.notNull(this.status, "status must not be null");
        Assert.notEmpty(this.items, "At least one item is required");
        validateItems();
    }
}
```

## Child Entity

```java
package {PACKAGE}.domain.{MODULE}.model;

import lombok.Getter;
import lombok.Setter;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;
import org.springframework.util.Assert;

/**
 * {Business}Item — child entity within {Business}Aggregator.
 * Use @Getter + @Setter only. Never modify directly; always go through the aggregate root.
 */
@Getter
@Setter
public class {Business}Item {

    private Long id;
    private Long {business}Id;
    private String productCode;
    private Integer quantity;
    private {Business}Amount amount;

    /**
     * Create a new item.
     */
    public static {Business}Item create(String productCode, Integer quantity,
                                         {Business}Amount amount) {
        Assert.hasText(productCode, "productCode must not be empty");
        Assert.notNull(quantity, "quantity must not be null");
        Assert.isTrue(quantity > 0, "quantity must be positive");
        Assert.notNull(amount, "amount must not be null");

        {Business}Item item = new {Business}Item();
        item.setProductCode(productCode);
        item.setQuantity(quantity);
        item.setAmount(amount);
        return item;
    }

    /**
     * Update quantity and recalculate amount if needed.
     */
    public void updateQuantity(Integer newQuantity, {Business}Amount unitAmount) {
        Assert.notNull(newQuantity, "quantity must not be null");
        Assert.isTrue(newQuantity > 0, "quantity must be positive");
        this.quantity = newQuantity;
        this.amount = new {Business}Amount(
            unitAmount.getValue().multiply(BigDecimal.valueOf(newQuantity)),
            unitAmount.getCurrency()
        );
    }

    /**
     * Validate item state.
     */
    public void validateState() {
        Assert.hasText(this.productCode, "productCode must not be empty");
        Assert.notNull(this.quantity, "quantity must not be null");
        Assert.isTrue(this.quantity > 0, "quantity must be positive");
        Assert.notNull(this.amount, "amount must not be null");
    }
}
```

## Status Enum (for Aggregate)

```java
package {PACKAGE}.domain.{MODULE}.model;

import lombok.AllArgsConstructor;
import lombok.Getter;
import java.util.Arrays;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * {Business} status enum with code, description, and terminal flag.
 */
@Getter
@AllArgsConstructor
public enum {Business}StatusEnum {

    INIT("I", "Initialized", false),
    PROCESSING("P", "Processing", false),
    COMPLETED("C", "Completed", true),
    CANCELLED("X", "Cancelled", true),
    FAILED("F", "Failed", true);

    private final String code;
    private final String description;
    private final boolean terminal;

    private static final Map<String, {Business}StatusEnum> CODE_MAP =
        Arrays.stream(values())
              .collect(Collectors.toMap({Business}StatusEnum::getCode, e -> e));

    public static {Business}StatusEnum fromCode(String code) {
        Assert.hasText(code, "status code must not be empty");
        {Business}StatusEnum status = CODE_MAP.get(code);
        if (status == null) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Unknown status code: " + code);
        }
        return status;
    }

    public boolean isTerminal() {
        return this.terminal;
    }
}
```