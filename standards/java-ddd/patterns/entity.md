# Entity Pattern

> When to use: Define an Entity when the object has a unique identity and lifecycle that persists across state changes. Use ValueObject for attributes that are defined entirely by their values and have no identity.

## Entity Class

```java
package {PACKAGE}.domain.{MODULE}.model;

import lombok.Getter;
import lombok.Setter;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;
import org.springframework.util.Assert;

/**
 * {Business} entity.
 * Use @Getter + @Setter only. Never use @Data on entities.
 */
@Getter
@Setter
public class {Business}Entity {

    private Long id;
    private String {business}No;
    private {Business}Type type;
    private {Business}StatusEnum status;
    private {Business}Amount amount;
    private String remark;
    private Long version;

    // ---------- Domain Behavior ----------

    /**
     * Create a new {business} with validated initial state.
     */
    public static {Business}Entity create(String {business}No, {Business}Type type,
                                           {Business}Amount amount, String remark) {
        Assert.hasText({business}No, "{business}No must not be empty");
        Assert.notNull(type, "type must not be null");
        Assert.notNull(amount, "amount must not be null");

        {Business}Entity entity = new {Business}Entity();
        entity.set{Business}No({business}No);
        entity.setType(type);
        entity.setStatus({Business}StatusEnum.INIT);
        entity.setAmount(amount);
        entity.setRemark(remark);
        entity.setVersion(0L);
        return entity;
    }

    /**
     * Transition status to PROCESSING. Domain rule: only INIT can transition.
     */
    public void startProcessing() {
        if (this.status != {Business}StatusEnum.INIT) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Cannot start processing from status: " + this.status.getCode());
        }
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
     * Cancel the {business}. Domain rule: INIT and PROCESSING can be cancelled.
     */
    public void cancel(String reason) {
        Assert.hasText(reason, "Cancel reason must not be empty");
        if (this.status == {Business}StatusEnum.COMPLETED
            || this.status == {Business}StatusEnum.CANCELLED) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Cannot cancel from status: " + this.status.getCode());
        }
        this.status = {Business}StatusEnum.CANCELLED;
        this.remark = reason;
    }

    // ---------- State Validation ----------

    /**
     * Check if the {business} can be modified.
     */
    public boolean isModifiable() {
        return this.status == {Business}StatusEnum.INIT;
    }

    /**
     * Validate state before persistence.
     */
    public void validateState() {
        Assert.hasText(this.{business}No, "{business}No must not be empty");
        Assert.notNull(this.type, "type must not be null");
        Assert.notNull(this.status, "status must not be null");
        Assert.notNull(this.amount, "amount must not be null");
    }
}
```

## ValueObject Class

```java
package {PACKAGE}.domain.{MODULE}.model;

import lombok.Data;
import java.math.BigDecimal;

/**
 * {Business} amount ValueObject.
 * Defined entirely by its value, no identity. Use @Data.
 */

/**
 * {Business} amount ValueObject.
 * Defined entirely by its value, no identity. Use @Data.
 */
@Data
public class {Business}Amount {

    private BigDecimal value;
    private String currency;

    public {Business}Amount(BigDecimal value, String currency) {
        Assert.notNull(value, "amount value must not be null");
        Assert.hasText(currency, "currency must not be empty");
        if (value.compareTo(BigDecimal.ZERO) < 0) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Amount must not be negative");
        }
        this.value = value;
        this.currency = currency;
    }

    public {Business}Amount add({Business}Amount other) {
        if (!this.currency.equals(other.getCurrency())) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Cannot add amounts with different currencies");
        }
        return new {Business}Amount(this.value.add(other.getValue()), this.currency);
    }

    public boolean isZero() {
        return this.value.compareTo(BigDecimal.ZERO) == 0;
    }
}
```

## Enum with code/description/terminal and fromCode()

```java
package {PACKAGE}.domain.{MODULE}.model;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * {Business} status enum.
 * Each constant carries code, description, and terminal flag.
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

    /**
     * Lookup by code. Throws if code is unknown.
     */
    public static {Business}StatusEnum fromCode(String code) {
        Assert.hasText(code, "status code must not be empty");
        {Business}StatusEnum status = CODE_MAP.get(code);
        if (status == null) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "Unknown status code: " + code);
        }
        return status;
    }

    /**
     * Check if the current status is a final/terminal state.
     */
    public boolean isTerminal() {
        return this.terminal;
    }
}
```