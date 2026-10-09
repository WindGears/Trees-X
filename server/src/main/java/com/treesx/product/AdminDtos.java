package com.treesx.product;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

public final class AdminDtos {
    private AdminDtos() {}
    public record Category(Long id,String name,int sortOrder,long revision,long productCount) {}
    public record CategoryEdit(@NotBlank @Size(max=40) String name,@Min(0) @Max(100000) int sortOrder,@Min(0) long revision) {}
    public record Item(String slug,String name,String category,String description,String cover,String displayStatus,
                       Long categoryId,int sortOrder,boolean listed,long revision) {}
    public record Detail(Item item,Presentation presentation) {}
    public record Edit(@NotBlank @Pattern(regexp="[a-z0-9]+(?:-[a-z0-9]+)*") @Size(max=80) String slug,
                       @NotBlank @Size(max=120) String name,@NotNull @Positive Long categoryId,
                       @NotBlank @Size(max=600) String description,@Size(max=512) String cover,
                       @NotNull @Pattern(regexp="prototype|formal") String displayStatus,
                       @Min(0) @Max(100000) int sortOrder,@Min(0) long revision,@NotNull @Valid Presentation presentation) {}
    public record Visibility(@Min(0) long revision,boolean listed) {}
}
