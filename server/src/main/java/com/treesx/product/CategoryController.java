package com.treesx.product;
import jakarta.validation.Valid;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController @Transactional(readOnly=true)
public class CategoryController {
    private final CategoryRepository categories;
    private final ProductRepository products;
    public CategoryController(CategoryRepository categories,ProductRepository products) { this.categories=categories; this.products=products; }
    private AdminDtos.Category dto(CategoryEntity c) { return new AdminDtos.Category(c.id,c.name,c.sortOrder,c.revision,products.countByCategoryId(c.id)); }
    @GetMapping("/api/v1/categories") public java.util.List<PublicCategory> published() {
        var used=products.findAllByListedTrueOrderBySortOrderAscSlugAsc().stream().map(p -> p.categoryId).collect(java.util.stream.Collectors.toSet());
        return categories.findAllByOrderBySortOrderAscIdAsc().stream().filter(c -> used.contains(c.id)).map(c -> new PublicCategory(c.id,c.name)).toList();
    }
    public record PublicCategory(Long id,String name) {}
    @GetMapping("/api/v1/admin/categories") public java.util.List<AdminDtos.Category> list() {
        return categories.findAllByOrderBySortOrderAscIdAsc().stream().map(this::dto).toList();
    }
    @PostMapping("/api/v1/admin/categories") @Transactional @ResponseStatus(HttpStatus.CREATED)
    public AdminDtos.Category create(@Valid @RequestBody AdminDtos.CategoryEdit edit) { return save(new CategoryEntity(),edit); }
    @PutMapping("/api/v1/admin/categories/{id}") @Transactional
    public AdminDtos.Category update(@PathVariable Long id,@Valid @RequestBody AdminDtos.CategoryEdit edit) {
        var c=categories.findById(id).orElseThrow(() -> AdminProductService.error(HttpStatus.NOT_FOUND,"未找到分类"));
        AdminProductService.revision(c.revision,edit.revision());
        var result=save(c,edit);
        for (var p:products.findAllByCategoryId(id)) { p.category=c.name; p.updatedAt=java.time.Instant.now(); }
        products.flush();
        return result;
    }
    private AdminDtos.Category save(CategoryEntity c,AdminDtos.CategoryEdit edit) {
        String name=edit.name().strip();
        if (!name.equals(c.name) && categories.existsByName(name)) throw AdminProductService.error(HttpStatus.CONFLICT,"分类名称已存在");
        c.name=name; c.sortOrder=edit.sortOrder(); return dto(categories.saveAndFlush(c));
    }
    @DeleteMapping("/api/v1/admin/categories/{id}") @Transactional @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id,@RequestParam long revision) {
        var c=categories.findById(id).orElseThrow(() -> AdminProductService.error(HttpStatus.NOT_FOUND,"未找到分类"));
        AdminProductService.revision(c.revision,revision);
        if (products.countByCategoryId(id)>0) throw AdminProductService.error(HttpStatus.CONFLICT,"分类仍被商品使用，请先调整商品分类");
        categories.delete(c); categories.flush();
    }
}
